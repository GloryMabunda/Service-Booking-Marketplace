# Service Booking System 💄

> **An appointment booking and management system designed for service-based businesses, allowing clients to discover services, view availability, and book appointments online.**

The Service Booking System is a full-stack application designed to help appointment-based businesses manage their services, availability, bookings, and clients from a central platform.

For this portfolio project, the system is implemented around a **makeup artist business**, allowing clients to browse makeup services, view availability, and make appointments online.

The system also provides the makeup artist with a secure administration portal where they can manage services, availability, bookings, and client information.

Although the example implementation is for a makeup artist, the underlying booking system is designed to be reusable for other appointment-based service providers.

Examples include:

- Makeup artists
- Hair stylists
- Nail technicians
- Beauty therapists
- Personal trainers
- Photographers
- Tutors
- Cleaning services
- Barbers
- Massage therapists
- Other service-based businesses

The goal is to build a practical booking system that can be adapted to different service businesses without changing the core booking functionality.

---

# 🚀 Project Overview

The system provides two main experiences:

## 👤 Client Website

Clients can:

- View the business and its services
- View service descriptions and pricing
- View available appointment dates and times
- Make a booking without creating an account
- Provide their contact details
- Receive booking confirmation
- View their booking details

## 🔐 Administrator Portal

The service provider can securely log in and:

- View all bookings
- View individual booking details
- View client information
- Manage services
- Manage service pricing
- Configure service duration
- Manage availability
- Block dates and times
- View appointments through a calendar
- Confirm or cancel bookings
- Mark bookings as completed
- Manage the booking schedule

---

# 🌍 Real-World Use Case

The portfolio implementation uses **Make Up by Glory** as the example business.

A client visiting the website could:

```text
View Services
      ↓
Choose a Makeup Service
      ↓
View Available Dates
      ↓
Choose Available Time
      ↓
Enter Contact Details
      ↓
Confirm Booking
      ↓
Booking Created
      ↓
Email / SMS Confirmation
```

The same system could then be configured for another service provider without changing the fundamental booking functionality.

---

# ✨ Key Features

## 💄 Service Management

Administrators can create and manage services.

Each service can contain:

- Service name
- Description
- Price
- Duration
- Active/inactive status

Example:

| Service | Duration | Price |
|---|---:|---:|
| Soft Glam | 1h 30m | R650 |
| Full Glam | 2h | R850 |
| Bridal Makeup | 2h 30m | R1,200 |
| Matric Dance Makeup | 2h | R900 |

These examples are specific to the makeup artist implementation and can be replaced with services appropriate to another business.

---

## 📅 Availability Management

The service provider can define when appointments are available.

The system supports:

- Working days
- Working hours
- Appointment duration
- Existing bookings
- Blocked dates
- Blocked time periods
- Multiple appointments per day

Availability is calculated based on the selected service duration.

For example, if a service requires two hours, the system should not offer a time slot that would overlap with another appointment.

---

## 📌 Booking System

Clients can select:

1. Service
2. Date
3. Available time
4. Contact details
5. Optional booking notes

The system validates availability when the booking is submitted.

Availability is checked server-side to prevent two clients from successfully booking the same appointment slot.

### Booking Statuses

Bookings can progress through statuses such as:

- Pending
- Confirmed
- Cancelled
- Completed
- No-show

---

## 🧾 Booking Details

Administrators can view detailed information about each booking.

Example:

```text
Booking #BK-000123

Client:
Sarah Mokoena

Email:
sarah@example.com

Phone:
082 XXX XXXX

Service:
Soft Glam Makeup

Date:
17 October 2026

Time:
10:00 – 11:30

Price:
R650

Status:
Confirmed

Notes:
Birthday makeup
```

---

# 🔔 Notifications

After a booking is successfully created, the system can send confirmation notifications to both the client and the service provider.

## 👤 Client

Example email/SMS:

> Your appointment has been confirmed for 17 October at 10:00. Service: Soft Glam Makeup. Total: R650.

## 💼 Service Provider

Example notification:

> New booking received from Sarah Mokoena for Soft Glam Makeup on 17 October at 10:00.

The notification system is designed so that email and SMS providers can be integrated without tightly coupling them to the booking logic.

Development can use mock notification services before connecting real providers.

---

# 📊 Administrator Portal

The administrator dashboard provides an overview of the business's bookings.

Example:

```text
Good morning, Glory 👋

Today's Bookings
        3

Upcoming Bookings
        12

Completed This Month
        24

Upcoming Appointments
--------------------------------
Sarah Mokoena    Soft Glam    09:00
Jane Dlamini     Bridal       12:00
Lerato M.        Full Glam    15:00
```

The administrator can also switch to a calendar view to manage appointments and availability.

---

# 🛠️ Technology Stack

## Backend

- Node.js
- TypeScript
- NestJS
- REST API

## Frontend

- HTML5
- CSS3
- Bootstrap
- Vanilla JavaScript
- Bootstrap Icons

## Database

- PostgreSQL

## Libraries

- FullCalendar — appointment calendar
- Nodemailer — email notifications
- PostgreSQL database libraries / ORM
- Additional lightweight libraries where they provide clear value

The project intentionally avoids large frontend frameworks such as React, Angular, or Vue.

The frontend will use standard HTML, CSS, Bootstrap, and vanilla JavaScript to keep the application lightweight and demonstrate understanding of the underlying web technologies.

## Development

- Git
- GitHub
- GitHub Actions
- npm
- REST APIs
- Automated testing

---

# 🏗️ Architecture

The application follows a modular backend architecture.

```text
Client Browser
      │
      │ HTTP / REST
      ▼
┌──────────────────────┐
│      NestJS API      │
├──────────────────────┤
│ Authentication       │
│ Bookings             │
│ Services             │
│ Availability         │
│ Notifications        │
└──────────┬───────────┘
           │
           ▼
     PostgreSQL
           │
           ├── Users
           ├── Services
           ├── Availability
           ├── Bookings
           └── Notifications
```

---

# 🧩 Core Modules

```text
Authentication
      │
      ├── Administrator Login
      └── Authentication / Authorization

Services
      │
      └── Service Management

Availability
      │
      ├── Working Hours
      └── Blocked Times

Bookings
      │
      ├── Create Booking
      ├── View Booking
      ├── Update Booking
      └── Booking Status

Notifications
      │
      ├── Email
      └── SMS

Administration
      │
      ├── Dashboard
      ├── Bookings
      ├── Services
      └── Calendar
```

---

# 🔄 Booking Flow

```text
Client
  │
  ▼
View Services
  │
  ▼
Select Service
  │
  ▼
Select Date
  │
  ▼
Check Availability
  │
  ▼
Select Time
  │
  ▼
Enter Client Details
  │
  ▼
Submit Booking
  │
  ▼
Server-Side Availability Check
  │
  ├── Slot unavailable
  │       └── Return error
  │
  └── Slot available
          │
          ▼
      Create Booking
          │
          ▼
   Send Notifications
          │
          ├── Client
          └── Administrator
```

---

# 🗄️ Database

The initial database design will include entities such as:

- Users
- Services
- Availability
- BlockedTimes
- Bookings
- Notifications

Additional entities may be introduced as the system evolves.

The database design will be documented in the `docs/` directory.

---

# 🔐 Security

The administrator portal will include authentication and authorization.

Security considerations include:

- Password hashing
- Secure authentication
- Role-based authorization
- Input validation
- Server-side validation
- Protection against unauthorized administration access
- Secure handling of client information
- Protection against duplicate bookings
- Environment-based configuration for secrets

Sensitive credentials and API keys will not be stored in source control.

---

# 🧪 Testing Strategy

The project will include automated testing for important business logic.

Testing will cover areas such as:

### Unit Tests

```text
✓ Service validation
✓ Availability calculation
✓ Booking validation
✓ Booking status changes
✓ Notification triggers
```

### Integration Tests

```text
✓ Database operations
✓ Booking creation
✓ Availability checks
✓ Authentication
✓ Authorization
```

### Business Logic Tests

Particular attention will be given to booking availability because preventing double-booking is a core requirement of the system.

```text
Client A ──┐
           ├──> Same Time Slot
Client B ──┘
              │
              ▼
       Availability Check
              │
       ┌──────┴──────┐
       ▼             ▼
   Available      Already Booked
       │             │
       ▼             ▼
   Create          Reject
   Booking         Booking
```

---

# 📚 Documentation

Additional project documentation will be maintained in the `docs/` directory.

Planned documentation includes:

- System specification
- Architecture
- Database design
- API specification
- Booking rules
- Availability engine
- Notification design
- Security
- Testing strategy
- Deployment

---

# 🗺️ Development Roadmap

## Phase 1 — Project Foundation

- [ ] Create NestJS project
- [ ] Configure TypeScript
- [ ] Configure PostgreSQL
- [ ] Establish project structure
- [ ] Configure environment variables
- [ ] Set up Git workflow

## Phase 2 — Services

- [ ] Service database model
- [ ] Service API
- [ ] Service management
- [ ] Public service listing

## Phase 3 — Availability

- [ ] Working hours
- [ ] Blocked dates
- [ ] Blocked times
- [ ] Availability calculation
- [ ] Calendar interface

## Phase 4 — Bookings

- [ ] Booking creation
- [ ] Booking validation
- [ ] Booking status
- [ ] Client details
- [ ] Double-booking prevention

## Phase 5 — Administrator Portal

- [ ] Administrator authentication
- [ ] Dashboard
- [ ] Booking management
- [ ] Service management
- [ ] Calendar management

## Phase 6 — Notifications

- [ ] Email confirmation
- [ ] Administrator notification
- [ ] SMS integration
- [ ] Notification history

## Phase 7 — Testing

- [ ] Unit tests
- [ ] Integration tests
- [ ] API tests
- [ ] Booking concurrency tests
- [ ] Authentication tests

## Phase 8 — Deployment

- [ ] Production configuration
- [ ] Database deployment
- [ ] Application deployment
- [ ] CI/CD
- [ ] Monitoring and logging

---

# 🚀 Future Enhancements

Potential future features include:

- Online payments
- Deposits
- Automated appointment reminders
- Rescheduling
- Cancellation policies
- Client booking lookup
- Client accounts
- Reviews and ratings
- Promotional discounts
- Multiple service providers
- Multiple locations
- Business analytics
- Revenue reporting
- Calendar synchronization
- WhatsApp notifications
- AI-powered booking assistance

---

# 🎯 Project Goals

This project is designed to demonstrate practical full-stack development using a real-world business scenario.

It demonstrates experience with:

- TypeScript
- Node.js
- NestJS
- REST API development
- PostgreSQL
- Relational database design
- Authentication and authorization
- Business-rule implementation
- Appointment scheduling
- Availability calculations
- External service integration
- Email and SMS notifications
- Automated testing
- CI/CD
- Application architecture

The project also demonstrates how a real business process can be translated into software with clear business rules, data relationships, validation, and administrative workflows.

Although **Make Up by Glory** is used as the primary example, the underlying system is intentionally designed as a reusable service-booking platform that can be adapted to many different appointment-based businesses.

---

# 📁 Repository Structure

```text
ServiceBookingSystem/
│
├── src/
│   ├── auth/
│   ├── bookings/
│   ├── services/
│   ├── availability/
│   ├── notifications/
│   └── admin/
│
├── public/
│
├── tests/
│
├── docs/
│
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── tsconfig.json
```

---

# 🚧 Project Status

**Currently in development.**

The project is being developed incrementally, with the architecture, database design, implementation, testing, and deployment documented throughout the development process.

---

# 📌 Future Vision

The long-term goal is to create a reusable booking platform that can support different types of service-based businesses.

The system should allow a business owner to:

```text
Configure Services
        ↓
Set Working Hours
        ↓
Manage Availability
        ↓
Receive Bookings
        ↓
Manage Appointments
        ↓
Notify Clients
        ↓
Track Business Activity
```

The makeup artist implementation provides the initial real-world scenario while keeping the underlying architecture flexible enough to support other appointment-based businesses.

---

## 💄 Project

**Service Booking System**

Appointment booking and management platform for service-based businesses.

Built with **Node.js / TypeScript / NestJS / PostgreSQL**.
