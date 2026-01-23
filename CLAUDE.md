# Taekwondo Tournament Data Repository

This repository contains tournament bracket data and championship lists for a Taekwondo competition (Newton's Championship 2025).

## Project Structure

```
/
├── 2025 NEWTONS CHAMPIONSHIP LIST.xlsm   # Master championship list (Excel)
├── Tournament ScheduleNewSparring.pdf     # Tournament schedule
├── BB Females Patterns/                   # Black Belt female patterns brackets
├── BB Females Sparring/                   # Black Belt female sparring brackets
├── BB Males Patterns/                     # Black Belt male patterns brackets
├── BB Males Sparring/                     # Black Belt male sparring brackets
├── CB Females Patterns/                   # Colored Belt female patterns brackets
├── CB Females Sparring/                   # Colored Belt female sparring brackets
├── CB Males Patterns/                     # Colored Belt male patterns brackets
└── CB Males Sparring/                     # Colored Belt male sparring brackets
```

## Terminology

- **BB**: Black Belt (1st Dan and above)
- **CB**: Colored Belt (White, Yellow, Green, Blue, Red)
- **Patterns**: Forms/poomsae competition
- **Sparring**: Fighting competition
- **Dan**: Black belt degree (1st, 2nd, 3rd, etc.)

## Category Organization

Brackets are organized by:
- **Belt Level**: BB (Black Belt) or CB (Colored Belt)
- **Gender**: Males or Females
- **Event Type**: Patterns or Sparring
- **Age Groups**: 4-5, 6-7, 8-9, 10-11, 12-14, 15-17, 18-35, 36+
- **Weight Classes** (Sparring only): Light, Middle, Heavy, Feather

## File Naming Convention

PDF files follow this pattern:
```
[Age Range] [Belt Level]-[Belt Rank] [Gender] [Event Type] [Weight Class].pdf
```

Example: `10-11 CB-All Blue Belts Males Sparring Heavy.pdf`

## Data Files

- All bracket data is stored as PDFs
- The master Excel file (.xlsm) contains the comprehensive championship list
- ZIP files contain compressed bracket collections
