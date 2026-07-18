"""Hevy Training compartment models — isolated from Oura Workout table."""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .models import Base


class HevyWorkout(Base):
    __tablename__ = "hevy_workout"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True, nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    estimated_volume_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    username: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    raw: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    exercises: Mapped[list["HevyExercise"]] = relationship(
        "HevyExercise", back_populates="workout", cascade="all, delete-orphan"
    )


class HevyExercise(Base):
    __tablename__ = "hevy_exercise"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    workout_id: Mapped[str] = mapped_column(String, ForeignKey("hevy_workout.id"), index=True)
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    muscle_group: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    exercise_template_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    workout: Mapped["HevyWorkout"] = relationship("HevyWorkout", back_populates="exercises")
    sets: Mapped[list["HevySet"]] = relationship(
        "HevySet", back_populates="exercise", cascade="all, delete-orphan"
    )


class HevySet(Base):
    __tablename__ = "hevy_set"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    exercise_id: Mapped[str] = mapped_column(String, ForeignKey("hevy_exercise.id"), index=True)
    index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    weight_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rpe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    indicator: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    prs: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    exercise: Mapped["HevyExercise"] = relationship("HevyExercise", back_populates="sets")
