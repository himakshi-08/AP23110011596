# Campus Microservices

This repository contains two backend microservices developed for the campus evaluation assignment. Both applications have been built as **REST APIs** using **Node.js, TypeScript, and Express.js** (No Python was used in this implementation).

## 1. Vehicle Maintenance Scheduler (`vehicle_maintence_scheduler`)
This service uses a custom **0/1 Knapsack Algorithm** (Dynamic Programming) to schedule vehicle maintenance tasks based on impact and available mechanic hours.

### How to Run
1. Navigate to the directory: `cd vehicle_maintence_scheduler`
2. Install dependencies: `npm install`
3. Start the Express server: `npx ts-node src/index.ts`
4. Send a `POST` request to `http://localhost:3000/api/schedule` with the authentication token in the JSON body.

## 2. Notification Priority Inbox (`notification_app_be`)
This service uses a custom **Max-Heap (Priority Queue)** data structure to process and return the top 10 most critical notifications based on predefined weights and timestamps.

### How to Run
1. Navigate to the directory: `cd notification_app_be`
2. Install dependencies: `npm install`
3. Start the Express server: `npx ts-node src/priorityInbox.ts`
4. Send a `POST` request to `http://localhost:3000/api/priority-inbox` with the authentication token in the JSON body.

## API Payload Example
Both endpoints expect a JSON body containing the active token:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

## System Design
For a detailed breakdown of the system architecture, scaling, database schema, and constraints for the notification system, please see the [notification_system_design.md](./notification_system_design.md) file.
