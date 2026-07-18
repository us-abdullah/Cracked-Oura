import json
from typing import List, Dict, Any, Optional
from datetime import date, timedelta

from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage
from backend.src.config import config_manager
from backend.src.database import SessionLocal
from backend.src import models


def _secs_to_hm(seconds: Optional[float]) -> Optional[str]:
    if seconds is None:
        return None
    try:
        s = int(float(seconds))
    except Exception:
        return None
    h, m = divmod(max(s, 0) // 60, 60)
    return f"{h}h {m}m"


def _round(v: Optional[float], n: int = 1):
    if v is None:
        return None
    try:
        return round(float(v), n)
    except Exception:
        return None


class DataAnalyst:
    """
    Interpretive Oura coach:
    - builds a clean, human-readable metrics snapshot from SQLite
    - asks the local LLM for advice grounded in that snapshot
    """

    def __init__(self):
        cfg = config_manager.get_config()
        model = cfg.get("llm_model", "llama3.2:3b")
        host = cfg.get("llm_host", "http://localhost:11434")
        use_reasoning = cfg.get("llm_reasoning", False)

        self.llm = ChatOllama(
            base_url=host,
            model=model,
            temperature=0.4,
            num_ctx=int(cfg.get("llm_num_ctx", 4096)),
            reasoning=bool(use_reasoning),
            streaming=False,
            keep_alive=-1,
        )
        self.today = date.today().strftime("%Y-%m-%d")

    def _build_snapshot(self, days: int = 14) -> Dict[str, Any]:
        db = SessionLocal()
        try:
            sleep_rows = (
                db.query(models.Sleep)
                .order_by(models.Sleep.day.desc())
                .limit(days)
                .all()
            )
            readiness_rows = {
                r.day: r
                for r in db.query(models.Readiness)
                .order_by(models.Readiness.day.desc())
                .limit(days)
                .all()
            }
            activity_rows = {
                r.day: r
                for r in db.query(models.Activity)
                .order_by(models.Activity.day.desc())
                .limit(days)
                .all()
            }
            session_rows = {
                r.day: r
                for r in db.query(models.SleepSession)
                .order_by(models.SleepSession.day.desc())
                .limit(days * 2)
                .all()
            }

            daily = []
            for s in sleep_rows:
                d = s.day
                r = readiness_rows.get(d)
                a = activity_rows.get(d)
                ss = session_rows.get(d)
                daily.append(
                    {
                        "day": str(d),
                        "sleep_score": s.score,
                        "readiness_score": r.score if r else None,
                        "activity_score": a.score if a else None,
                        "steps": a.steps if a else None,
                        "total_sleep": _secs_to_hm(
                            ss.total_sleep_duration if ss else None
                        ),
                        "deep_sleep": _secs_to_hm(
                            ss.deep_sleep_duration if ss else None
                        ),
                        "rem_sleep": _secs_to_hm(
                            ss.rem_sleep_duration if ss else None
                        ),
                        "awake": _secs_to_hm(ss.awake_time if ss else None),
                        "sleep_latency": _secs_to_hm(ss.latency if ss else None),
                        "sleep_efficiency_pct": _round(
                            ss.efficiency if ss else None, 0
                        ),
                        "avg_hrv_ms": _round(ss.average_hrv if ss else None, 0),
                        "resting_hr_bpm": _round(
                            ss.lowest_heart_rate if ss else None, 0
                        ),
                    }
                )

            def avg(vals):
                vals = [v for v in vals if v is not None]
                if not vals:
                    return None
                return round(sum(vals) / len(vals), 1)

            averages = {
                "avg_sleep_score": avg([x["sleep_score"] for x in daily]),
                "avg_readiness_score": avg([x["readiness_score"] for x in daily]),
                "avg_activity_score": avg([x["activity_score"] for x in daily]),
                "avg_steps": avg([x["steps"] for x in daily]),
                "avg_hrv_ms": avg([x["avg_hrv_ms"] for x in daily]),
                "avg_resting_hr_bpm": avg([x["resting_hr_bpm"] for x in daily]),
                "avg_sleep_efficiency_pct": avg(
                    [x["sleep_efficiency_pct"] for x in daily]
                ),
            }

            return {
                "as_of": self.today,
                "days_available": len(daily),
                "latest": daily[0] if daily else None,
                "averages": averages,
                "recent_daily": daily,
            }
        finally:
            db.close()

    def chat(self, history: List[Dict[str, str]]) -> Dict[str, Any]:
        user_query = history[-1]["content"] if history else ""
        thoughts: List[Dict[str, Any]] = []

        try:
            snapshot = self._build_snapshot(14)
            thoughts.append(
                {
                    "step": 1,
                    "type": "tool_call",
                    "tool": "load_health_snapshot",
                    "params": {"days": 14},
                    "content": "Loaded formatted sleep/readiness/activity snapshot",
                }
            )
            thoughts.append(
                {
                    "step": 2,
                    "type": "tool_result",
                    "content": json.dumps(snapshot, default=str)[:3500],
                }
            )

            if not snapshot.get("latest"):
                return {
                    "response": (
                        "I don't have enough Oura data ingested yet to advise you. "
                        "Import an export first, then ask again."
                    ),
                    "thoughts": thoughts,
                }

            prior = ""
            if len(history) > 1:
                bits = []
                for m in history[-6:-1]:
                    bits.append(
                        f"{m.get('role', 'user')}: {(m.get('content') or '')[:250]}"
                    )
                prior = "\n".join(bits)

            system = f"""You are Usman Biotracker's personal recovery/sleep coach (Recovery compartment).
Today is {self.today}.

Use ONLY the snapshot JSON. Durations are already human-readable (like "5h 56m").
Percentages are already percent. HRV is ms. Heart rate is bpm.

Rules:
1) Answer factual questions directly from the snapshot.
2) For advice (improve sleep, recovery, energy, stress): open with 1-2 sentences that cite THEIR numbers
   (latest sleep score/duration/efficiency/awake time, vs averages when useful).
3) Then give 3-6 concrete bullets tied to those gaps (e.g. short total sleep, high awake time, low efficiency).
4) Prefer actionable next-night changes over generic wellness fluff.
5) No medical diagnosis. No invented metrics. If a field is null, skip it.

SNAPSHOT:
{json.dumps(snapshot, default=str)}
"""

            human = user_query
            if prior:
                human = f"Recent chat:\n{prior}\n\nQuestion: {user_query}"

            answer = str(
                self.llm.invoke(
                    [SystemMessage(content=system), HumanMessage(content=human)]
                ).content
            ).strip()

            return {
                "response": answer
                or "I loaded your data but couldn't generate advice. Please try again.",
                "thoughts": thoughts,
            }

        except Exception as e:
            print(f"Agent Error: {e}")
            return {
                "response": (
                    f"I hit an error analyzing your data: {e}. "
                    "Make sure Ollama is running and try again."
                ),
                "thoughts": thoughts
                + [{"step": 99, "type": "error", "content": str(e)}],
            }
