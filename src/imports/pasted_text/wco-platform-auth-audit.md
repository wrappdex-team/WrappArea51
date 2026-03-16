 Executive Summary

This assessment combined two strands of work. The first strand documented how the WCO platform authenticates users and administrators through Supabase, wallet sessions, and administrative sessions.

The second strand examined how that architecture could potentially be abused from the browser by a normal authenticated user who inspects the frontend and manually calls backend endpoints. In simple terms, the issue can be summarized as follows: A user accessing the public website could inspect the application, discover how the administrative login flow operates, identify which wallet belongs to an administrator, and then attempt to recreate the administrative authentication process manually.

During testing, this process succeeded sufficiently to obtain an administrative session and access privileged routes. This indicates that the platform’s trust boundary is overly exposed to the client. In technical terms:
The backend API surface is discoverable from the shipped frontend bundle.
Authentication flows are reconstructable through browser network inspection.
The administrative challenge / verify workflow can be manually replayed.
Administrative wallet identity can be inferred from client-visible data.
Administrative session tokens can then be used to access privileged endpoints.

The most important conclusion is that this is not merely API documentation leakage. The observed behaviour indicates a potential privilege-escalation path from a standard user session to administrative access.

2. Non-Technical Explanation

To understand the issue without technical knowledge, imagine the platform as a building with three doors.

Door 1 - Public Reception
Anyone visiting the website can pass through the public entrance because the site itself provides the pass needed to reach backend services.

Door 2 - User Area
A wallet session proves which user you are and allows access to personal user functions.

Door 3 - Admin Office
Administrative access should require stronger proof that the user is an administrator. The problem is that too much information about all three doors is visible from reception.
A technically capable user can observe how staff move through the doors, identify which badge belongs to the manager, and imitate the administrative sign-in flow closely enough that the system accepts them.
As a result, a malicious user could potentially perform actions such as:
Viewing internal platform data
Changing records
Running sensitive maintenance operations


3. Technical Summary

The application uses three authentication layers:

1. Supabase Gateway Authentication
Bearer JWT token used to access the Supabase Edge Function.

2. Wallet Session Authentication
Backend-issued wallet session token tied to a wallet address.

3. Administrative Challenge / Verify Flow
Produces a short-lived administrative session token.

The risk arises because:
The Supabase bearer token is present in the frontend.
Backend route structures are discoverable in the client bundle.
Administrative wallet identity can be inferred from client-visible data.
The challenge / verify flow can be manually replayed.
The resulting admin session unlocks a broad administrative API surface.
The existing report already documents the wallet session and admin session architecture:

Session Type
TTL
Wallet Session
4 hours
Admin Session
 20 minutes


4. Scope of Assessed Behaviour

The assessment covered:
Supabase bearer-based access to the Edge Function
Wallet registration and wallet session issuance
Chat message posting and authentication requirements
Administrative wallet identification
Admin challenge / verify authentication flow
Admin dashboard access
Route discovery from the frontend bundle

Exposure of administrative and maintenance API surfaces.This report does not claim source-code review of backend implementations. It documents what was observed and reproduced from the client side only.

5. Architecture Observed

Client Browser │ ▼ Supabase Edge Gateway │ ▼ WCO Backend Edge Function │ ▼ Application Logic

Because the backend is accessed through this architecture, the client has visibility into:
Backend route structures
Request formats
API helper logic

Even when the backend enforces access checks, these elements remain visible.

6. Observed Behaviour

6.1 Public Gateway Access

All API calls use a Supabase bearer token in the Authorization header.
This token represents project-level access to the Edge Function, not user identity.

6.2 Wallet Session Flow

Endpoint observed: POST /wallet/register .This endpoint issues a backend wallet session token bound to a wallet address.

The session token is used in the header: X-Wallet-Session

The token allows authenticated user actions such as chat posting.

Wallet session TTL: 4 hours

6.3 Admin Wallet Identification

Chat responses exposed:
Wallet identifiers
isAdmin flag

This made it possible to correlate a wallet address with administrator status. External OSINT sources such as Hashscan and token holder inspection further confirmed wallet identity.

6.4 Admin Challenge Issuance

Observed endpoint: POST /admin/challenge
Returned challenge included:
Wallet
Nonce
Timestamp
action text
expiry (5 minutes)

6.5 Admin Verification and Session Issuance

Observed endpoint: POST /admin/verify

Returned:
admin session token
TTL: 20 minutes
wallet: 0.0.9707752

6.6 Admin Dashboard Access

Observed endpoint: GET /admin/dashboard

Using the admin session token returned operational platform metrics:
Athletes
Events
Battles
Proposals
Applications
Sponsors
Inquiries
votes

7. Important Technical Clarification on the Signature

A digital signature is not the same as a public key. Public keys are expected to be publicly obtainable from:
Hedera infrastructure
Hashscan
SDK queries

That alone should not allow an attacker to generate a valid signature.
The correct security observation is:
The public key for the admin wallet appeared publicly obtainable, and the observed admin verify flow accepted a submitted signature value without sufficiently demonstrating possession of the private key.

Possible causes include:
Improper signature verification
Accepting malformed signatures
Accepting replayed signatures
Verifying against an incorrect message format
Using publicly derivable values instead of wallet signatures
Weak challenge binding
Challenge reuse

Without backend code review, the issue should be described as: Acceptance of a forged or externally constructed admin verify request.

8. Step-by-Step Reproduction

This reproduction narrative is provided for internal validation, not for public exploit documentation.

Step 1 - Access Public Application
User visits the platform normally and interacts with the frontend.

Step 2 - Inspect Frontend
Using browser developer tools inspect:
bundled JavaScript
network traffic
request headers
route names

Routes discovered included:
wallet registration
admin challenge
admin verify
admin dashboard
additional admin operations

Step 3 - Capture Bearer Token
Observe Supabase bearer token used in: Authorization: Bearer

Step 4 - Identify Admin Wallet

Query chat endpoint and inspect message metadata.

Chat objects contained:
Wallet
isAdmin flag

Admin wallet identified: 0.0.9707752

Step 5 - Confirm Admin Status

Send request to admin-check endpoint to confirm wallet status.

Response confirmed wallet treated as administrator.

Step 6 - Request Admin Challenge

Call: POST /admin/challenge

Receive challenge payload.

Step 7 - Submit Verify Request

Send: POST /admin/verify

Including:
admin wallet
Nonce
signature value

Response returned valid admin session token.



Step 8 - Access Admin Dashboard

Call: GET /admin/dashboard


Headers: Authorization: Bearer X-Admin-Wallet: X-Admin-Session:
Dashboard response returned administrative metrics.

Step 9 - Enumerate Additional Admin Routes

Frontend bundle revealed numerous administrative routes available through the same session.

9. Access Achieved
Administrative API surface allowed:
Admin status checks
Dashboard analytics
Athlete creation / deletion
Event creation / modification
Bracket generation
Battle management
Winner declaration
Airdrop confirmation
Governance proposal management
Configuration management
Application management
Sponsor management
Sponsor inquiries
Snapshot exports
Maintenance endpoints included:
chat clearing
vote purging
data seeding
destructive reset-style operations

Observed access level was consistent with full administrative control.

10. Risk Analysis
Confidentiality - High
Attackers could view internal operational data and platform records.

Integrity - High
Administrative access could alter:
event outcomes
governance state
platform records

Availability - High

Maintenance routes allow destructive operations.

Attack Complexity - Low to Moderate

Requires browser dev tools and API interaction.



Required Privileges - Low

A normal authenticated user session appears sufficient.


11. CVSS Assessment
Recommended CVSS v3.1 base score: 8.8 HIGH
Vector: CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H

Explanation
Network-based attack
Low complexity
Requires user session
No victim interaction
High impact to confidentiality, integrity, availability

Possible Escalation to Critical
If testing confirms no authenticated user session is required:
CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H Score: 9.8 Critical

12. Primary Findings
Finding 1 - Admin Authentication Workflow Reconstructable

Severity: High
Frontend exposed enough information to reproduce administrative authentication flows.

Finding 2 - Admin Wallet Identity Discoverable

Severity: Medium

Wallet identity discoverable via chat metadata and blockchain OSINT.

Finding 3 - Weak Admin Verify Logic

Severity: Critical

Admin verify step accepted forged or externally constructed signature flows.

Finding 4 - Admin Routes Exposed in Client

Severity: High

Public bundle revealed full administrative API surface.

Finding 5 - Session TTL Mitigates but Does Not Prevent Abuse


Severity: Medium

Short session duration limits dwell time but not exploitability.

13. Likely Root Cause
The likely root cause is weak server-side verification of the admin authentication challenge.

The system may not be enforcing:
correct signature validation
message binding
nonce usage
one-time challenge enforcement

14. Business Impact
Potential consequences include:
Unauthorized administrative access
Manipulation of competition results
Data corruption or deletion
Fraudulent platform actions
Loss of user trust
Governance disputes
Sponsor relationship damage

15. Recommended Remediation
Immediate Actions:
Invalidate any admin sessions created during testing.
Rotate any secrets associated with admin authentication.
Disable destructive admin test routes.

Short-Term Fixes:
Require wallet challenge signing via WalletConnect or equivalent.
Verify signatures server-side against exact challenge message.
Enforce one-time challenge usage.
Bind admin sessions to wallet + nonce + issuance time.

Medium-Term Fixes:
Separate admin management backend.
Remove admin markers from client responses.
Implement full audit logging for admin operations.

Validation Tests
Ensure backend rejects:
replayed signatures
malformed signatures
altered message formats
expired challenges
16. Retest Procedure
After remediation confirm:
admin wallet discovery does not lead to escalation
verify requires genuine wallet signing
replay attempts fail
admin sessions cannot be forged
destructive endpoints are restricted
client bundle no longer exposes admin routes

17. Final Conclusion
The combined assessment indicates a serious privilege escalation risk within the WCO platform’s administrative authentication design.

Evidence shows that:
the admin challenge / verify workflow was executed
a valid admin session token was obtained
privileged routes such as /admin/dashboard were accessible

The core issue can be summarized as:
An attacker operating from a normal client session could discover the administrative authentication workflow, identify the admin wallet, reconstruct the verify process, and obtain effective administrative access without demonstrating secure private-key control.

Recommended severity: CVSS v3.1: 8.8 HIGH

Escalating to: 9.8 CRITICAL
