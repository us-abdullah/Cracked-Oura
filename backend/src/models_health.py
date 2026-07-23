"""Health compartment models — Sheets-identical schemas for supplements, body, bloodwork."""

from datetime import date
from typing import Optional

from sqlalchemy import String, Float, Date, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base


# Column keys match Google Sheets headers (normalized for SQL where needed).
SUPPLEMENT_BOOL_COLUMNS = [
    "Creatine",
    "Omega3",
    "Multivitamin",
    "D3K2",
    "Taurine",
    "Magnesium Glycinate",
    "Glycine",
    "Ashwagandha KSM66",
    "L-Theanine",
    "Apigenin",
    "Caffeine",
    "L-Citrulline",
    "NAC",
    "Beta-Alanine",
    "Lion's Mane",
    "Collagen Peptides",
    "Astaxanthin",
]

# Calendar day color depends only on these (overall % still uses all columns).
CORE_COLOR_SUPPLEMENTS = [
    "Creatine",
    "Omega3",
    "Multivitamin",
    "D3K2",
    "Taurine",
    "Magnesium Glycinate",
    "Glycine",
    "L-Theanine",
    "Apigenin",
]


class HealthSupplementLog(Base):
    """One row per day — binary taken/missed per supplement + optional Notes."""

    __tablename__ = "health_supplement_log"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    day: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    creatine: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    omega3: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    multivitamin: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    d3k2: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    taurine: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    magnesium_glycinate: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    glycine: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    ashwagandha_ksm66: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    l_theanine: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    apigenin: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    caffeine: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    l_citrulline: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    nac: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    beta_alanine: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    lions_mane: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    collagen_peptides: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    astaxanthin: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# Sheet header -> ORM attribute
SUPPLEMENT_SHEET_TO_ATTR = {
    "Creatine": "creatine",
    "Omega3": "omega3",
    "Multivitamin": "multivitamin",
    "D3K2": "d3k2",
    "Taurine": "taurine",
    "Magnesium Glycinate": "magnesium_glycinate",
    "Glycine": "glycine",
    "Ashwagandha KSM66": "ashwagandha_ksm66",
    "L-Theanine": "l_theanine",
    "Apigenin": "apigenin",
    "Caffeine": "caffeine",
    "L-Citrulline": "l_citrulline",
    "NAC": "nac",
    "Beta-Alanine": "beta_alanine",
    "Lion's Mane": "lions_mane",
    "Collagen Peptides": "collagen_peptides",
    "Astaxanthin": "astaxanthin",
}


class HealthBodyMetrics(Base):
    __tablename__ = "health_body_metrics"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    body_fat_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class HealthBloodwork(Base):
    __tablename__ = "health_bloodwork"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    total_cholesterol: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hdl: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ldl: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    triglycerides: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fasting_glucose: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hba1c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vitamin_d: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vitamin_b12: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    iron: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ferritin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    magnesium: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    zinc: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    testosterone: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# Daily macros / hydration — Google Sheet "Daily Macro Tracker"
NUTRITION_NUMERIC_COLUMNS = [
    "Calories",
    "Protein",
    "Carbs",
    "Fat",
    "Fiber",
    "Sugar",
    "Water",
]

# Targets for ~140 lb active male (calendar colors use protein primarily).
NUTRITION_BODYWEIGHT_LB = 140
NUTRITION_PROTEIN_TARGET_G = 140  # ~1 g per lb
NUTRITION_PROTEIN_OK_G = 98  # ~0.7 g per lb → yellow
NUTRITION_CALORIES_TARGET = 2200  # soft reference for chips / chart context


class HealthNutritionLog(Base):
    """One row per day — macros + water + optional Notes."""

    __tablename__ = "health_nutrition_log"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    calories: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    protein: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    carbs: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fiber: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sugar: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    water: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


NUTRITION_SHEET_TO_ATTR = {
    "Calories": "calories",
    "Protein": "protein",
    "Carbs": "carbs",
    "Fat": "fat",
    "Fiber": "fiber",
    "Sugar": "sugar",
    "Water": "water",
    # Common sheet variants
    "Water (oz)": "water",
    "Water (OZ)": "water",
    "Protein (g)": "protein",
    "Carbs (g)": "carbs",
    "Fat (g)": "fat",
    "Fiber (g)": "fiber",
    "Sugar (g)": "sugar",
    "Calories (kcal)": "calories",
}
