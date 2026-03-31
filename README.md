# Taekwondo Tournament Management System

**A robust, real-time web application designed to orchestrate martial arts tournaments, manage competitor brackets, and display live schedules.**

As part of the **Nexus AI Business Solutions Portfolio**, this application was originally developed for the Newtons Championship. Moving forward, it serves as the foundational template for a generalized Martial Arts Tournament SaaS, allowing studio owners to seamlessly organize events.

## 🏆 Core Capabilities

- **Automated Bracket Generation:** Parses Excel `.xlsm` rosters to dynamically generate sparring and pattern brackets.
- **Live Scheduling:** Real-time event synchronization across multiple rings/mats.
- **Competitor Management:** Handles Black Belt (BB) and Color Belt (CB) divisions, separated by gender, age, and weight classes.
- **Digital Displays:** Outputs clean, high-contrast UI for TV monitors at the event.

## 🛠 Tech Stack

- **Frontend:** React / Vite
- **Backend:** Node.js Express server
- **Database:** Prisma ORM (configured for scalable tournament data)
- **Deployment:** Vercel / Docker

## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/camster91/taekwondo-tournament.git
cd taekwondo-tournament

# Install dependencies
npm install

# Start the development server
npm run dev
```

## 📈 Future Monetization & SaaS Strategy

- **White-Labeling:** Package the app as a white-label solution for independent Dojangs.
- **GlowOS Integration:** Allow tournament directors to ask their Pi Coding Agent to *"Shift all Ring 2 matches by 15 minutes due to a delay,"* automatically updating all digital displays.
- **Payment Gateway:** Integrate registration and entry fee collection directly into the bracket generator.

---
*Developed by Cameron Ashley / Nexus AI.*
