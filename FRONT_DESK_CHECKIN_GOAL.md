# GOLF FLIPPER — PHYSICAL FRONT-DESK RESERVATION CHECK-IN

## Single Objective

Create a complete physical front-desk check-in experience for customers who already booked a tee time online.

The existing behavior where the player presses `E` and the entire check-in completes instantly is unacceptable.

The customer must tell the player their name, the player must use the physical front-desk computer to locate the reservation, verify it, collect any outstanding payment, give change when necessary, complete the check-in, and physically provide the customer with the items needed for their round.

Work only on reservation check-in.

Do not work on:

- Course maintenance
- Parking expansion
- Clubhouse redesign
- Driving range
- Deliveries
- Pro-shop restocking
- New employee systems
- Walk-in tee-time creation
- Additional golf holes
- Unrelated cash-register visual polishing

Reuse the existing cash/card payment system wherever practical instead of creating a disconnected second payment system.

---

# Required Project Context

Before editing, read:

1. `AGENTS.md`
2. `Design_Doc.md`
3. `Golf_Flipper_Complete_Game_Vision.md`
4. `CASH_REGISTER_GOAL.md`
5. Existing reservation, customer, payment, front-desk, inventory, and checkout code
6. Existing Playwright and QA tools
7. Current Git diff and current working-tree state

Inspect the current implementation through normal gameplay before changing it.

Do not reset, revert, or replace successful existing cash-register work.

---

# Desired Customer Journey

The complete check-in experience must be:

1. Customer drives onto the property.
2. Customer parks.
3. Customer exits the vehicle.
4. Customer walks into the clubhouse.
5. Customer joins the front-desk queue.
6. Customer reaches the desk.
7. Customer greets the player.
8. Customer says the name attached to the reservation.
9. Player enters front-desk mode.
10. Player physically looks toward the front-desk computer.
11. Computer displays today’s reservations.
12. Player searches or finds the customer’s name.
13. Player clicks the correct reservation.
14. Reservation details appear.
15. Player verifies the tee time, group size, holes, rentals, cart, deposit, and remaining balance.
16. Player confirms that the arriving customer matches the reservation.
17. Customer pays any remaining balance.
18. Player completes physical card or cash payment.
19. Player gives correct change for cash.
20. Reservation becomes paid and checked in.
21. Player provides a scorecard and any required rental or cart item.
22. Player tells the customer where to go.
23. Customer takes the items.
24. Customer leaves the desk and walks toward the first tee, cart area, or waiting area.
25. The next customer advances in line.

No single press of `E` may complete multiple major steps.

---

# Customer Conversation

The customer must communicate naturally.

The customer should say something similar to:

> “Hi, I have a reservation under Daniel Brooks.”

Possible variations:

> “Hey, we booked a tee time under Melissa Carter.”

> “Good morning. The reservation should be under Robert Kim.”

> “We have a ten-thirty tee time. The name is Jordan Lee.”

> “I booked online for three people under Ashley Morgan.”

The dialogue may appear as:

- A speech bubble
- Subtitle text
- A dialogue panel grounded near the customer
- Voice audio with subtitle support

Do not show only:

```text
Press E to check in customer