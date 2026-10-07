# Service Booking Marketplace

A full-stack ASP.NET Core service booking marketplace that connects clients with service providers, enabling service discovery, availability management, appointment scheduling, deposits, payments, and automated notifications.

## Project Overview

The platform is designed for service-based businesses such as:

- Makeup artists
- Hair stylists
- Beauty therapists
- Personal trainers
- Photographers
- Tutors
- Cleaning services
- Other appointment-based service providers

Providers can manage their services, pricing, availability, blocked times, and bookings. Clients can discover providers, choose a service, select an available time slot, and complete a booking.

## Key Features

### Client

- Register and manage a profile
- Browse service providers and services
- View provider profiles and service details
- Check provider availability
- Book a service
- Pay a required deposit
- View and manage bookings
- Receive booking notifications
- Leave reviews after completed services

### Service Provider

- Create and manage a provider profile
- Create and manage services
- Set service prices and durations
- Configure deposit requirements
- Define recurring working hours
- Block specific dates and times
- Manage bookings through a calendar
- View clients and booking history
- Track revenue and booking activity
- Receive booking notifications
- Manage reviews

### Booking & Availability

The booking engine considers:

- Provider working hours
- Service duration
- Buffer time between appointments
- Existing bookings
- Blocked dates and times
- Booking status
- Deposit/payment requirements

Availability is validated server-side when a booking is created to prevent double-booking.

### Payments

Services can be configured to require:

- No payment
- A fixed deposit
- A percentage-based deposit

Payment processing is abstracted behind a payment service so that a payment gateway can be integrated without tightly coupling the booking system to a specific provider.

### Notifications

Notifications are designed around an abstraction layer supporting:

- SMS
- Email
- In-app notifications

Development environments can use mock notification services without sending real messages.

## Technology Stack

### Backend

- C#
- ASP.NET Core
- ASP.NET Core Identity
- Entity Framework Core
- REST APIs
- SQL Server
- Swagger / OpenAPI

### Frontend

- ASP.NET Core MVC / Razor
- HTML5
- CSS3
- JavaScript
- jQuery
- Bootstrap
- DataTables
- FullCalendar
- Chart.js

### Development & DevOps

- Git
- GitHub
- GitHub Actions
- Automated builds and tests
- CI/CD

## Architecture

The application uses a modular monolith architecture with clear separation of responsibilities.

```text
Service-Booking-Marketplace
│
├── Web
│   └── Controllers, APIs and UI
│
├── Application
│   └── Business use cases and services
│
├── Domain
│   └── Entities and business rules
│
├── Infrastructure
│   └── Database and external integrations
│
└── Tests
    └── Unit and integration tests
```

The project is intentionally designed as a modular monolith rather than microservices. This keeps the solution maintainable while demonstrating separation of concerns and scalable application design.

## Main Modules

- Authentication & Authorization
- Providers
- Clients
- Services
- Availability
- Bookings
- Payments
- Notifications
- Reviews
- Reporting
- Administration

## Booking Flow

```text
Client
  ↓
Search providers/services
  ↓
Select service
  ↓
Select date
  ↓
Check availability
  ↓
Select time
  ↓
Create booking
  ↓
Payment required?
  ├── No → Confirm booking
  │
  └── Yes
       ↓
     Payment gateway
       ↓
     Server-side payment verification
       ↓
     Confirm booking
  ↓
Notify client + provider
```

## Database

The database will contain core entities such as:

- Users
- Providers
- Clients
- ServiceCategories
- Services
- ProviderAvailability
- ProviderBlockedTimes
- Bookings
- BookingStatusHistory
- Payments
- PaymentTransactions
- Notifications
- Reviews

The database design will be documented separately in the `docs/` directory.

## Documentation

Project documentation will be maintained alongside the source code.

- [System Specification](docs/01-system-specification.md)
- [Architecture](docs/02-architecture.md)
- [Database Design](docs/03-database-design.md)
- [API Specification](docs/04-api-specification.md)
- [Booking Workflow](docs/05-booking-workflow.md)
- [Availability Engine](docs/06-availability-engine.md)
- [Payment Design](docs/07-payment-design.md)
- [Notification Design](docs/08-notification-design.md)
- [Security](docs/09-security.md)
- [Testing Strategy](docs/10-testing-strategy.md)
- [Deployment](docs/11-deployment.md)

## Development Roadmap

### Phase 1 — Foundation

- Solution structure
- Authentication and authorization
- User roles
- Provider profiles
- Client profiles

### Phase 2 — Services

- Service categories
- Provider services
- Pricing
- Service duration
- Deposit configuration

### Phase 3 — Availability

- Weekly working hours
- Blocked dates and times
- Calendar
- Availability calculation

### Phase 4 — Booking

- Booking creation
- Booking status lifecycle
- Double-booking protection
- Client booking management
- Provider booking management

### Phase 5 — Payments

- Deposit calculation
- Payment integration
- Payment verification
- Payment transaction history

### Phase 6 — Notifications

- Booking confirmations
- Payment notifications
- Cancellation notifications
- SMS/email abstraction

### Phase 7 — Marketplace

- Provider discovery
- Search and filtering
- Reviews and ratings
- Provider profiles

### Phase 8 — Quality & Deployment

- Unit tests
- Integration tests
- Booking concurrency tests
- API testing
- Security testing
- CI/CD
- Production deployment

## Future Enhancements

Potential future features include:

- Booking reminders
- Rescheduling and cancellation rules
- Refund processing
- Provider analytics
- Revenue reporting
- Multiple provider staff members
- Multiple service locations
- Discounts and promotions
- AI-powered booking assistant
- AI-powered provider reporting assistant

Example AI interactions:

> "I need a makeup artist in Pretoria for Saturday afternoon, with a budget of R700."

> "How many bookings did I have this month?"

## Portfolio Purpose

This project is being developed as a production-style portfolio application to demonstrate practical experience with:

- Full-stack .NET development
- REST API design
- Relational database design
- Business-rule implementation
- Authentication and authorization
- Payment workflows
- Availability and scheduling logic
- External service integrations
- Automated testing
- CI/CD
- Application architecture
- AI integration

## Status

**In development**

The repository will evolve incrementally, with architecture, database design, implementation, testing, and deployment documented as the project progresses.
