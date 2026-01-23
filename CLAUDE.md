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

---

## Tournament Management App

The `app/` directory contains a full-stack web application for managing tournaments.

### Running the App

```bash
cd app
npm install
npm run db:push     # Initialize database
npm run dev         # Start dev server (http://localhost:5173)
```

### Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express + Prisma
- **Database**: SQLite

### Features

1. **Competitor Management**
   - Import from Excel files
   - CRUD operations with search/filter
   - Persistent registry across tournaments

2. **Tournament Configuration**
   - Create tournaments with date/location
   - Register competitors (Patterns/Sparring)
   - Configure age groups and weight classes

3. **Auto-Categorization Engine**
   - Rules-based division generation
   - BB/CB separation, gender separation
   - Age groups, weight classes for sparring
   - Automatic division splits (>8 competitors)

4. **Bracket Generation**
   - 8-person double-elimination brackets
   - School-spread seeding (avoids same-school first round)
   - Visual bracket editor

5. **PDF Export**
   - Export brackets matching current format
   - Batch export all divisions

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/competitors` | List competitors |
| `POST /api/competitors/import` | Import from Excel |
| `GET /api/tournaments` | List tournaments |
| `POST /api/tournaments/:id/registrations/bulk` | Bulk register |
| `POST /api/divisions/tournament/:id/auto-generate` | Auto-categorize |
| `POST /api/brackets/division/:id/generate` | Generate bracket |

### Project Structure

```
app/
├── prisma/schema.prisma          # Database schema
├── src/
│   ├── server/
│   │   ├── routes/               # API endpoints
│   │   └── services/
│   │       ├── categorization-engine.ts
│   │       ├── bracket-generator.ts
│   │       └── excel-import.ts
│   ├── client/
│   │   ├── pages/                # React pages
│   │   └── components/           # UI components
│   └── shared/constants/         # Belt, age, weight configs
```
