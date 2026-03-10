# Real-Time Chat Feature — Technical Design Document

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Proposed Solution](#2-proposed-solution)
3. [System Architecture](#3-system-architecture)
4. [Component Breakdown and Responsibilities](#4-component-breakdown-and-responsibilities)
5. [API Design and Data Models](#5-api-design-and-data-models)
6. [Security Considerations](#6-security-considerations)
7. [Performance Requirements](#7-performance-requirements)
8. [Deployment Strategy](#8-deployment-strategy)
9. [Trade-offs and Alternatives Considered](#9-trade-offs-and-alternatives-considered)
10. [Success Metrics](#10-success-metrics)

---

## 1. Problem Statement

### 1.1 Why Employees Need a Chat Feature

The Employee Management App currently serves as the system of record for workforce data, but it provides no communication channel between employees. Teams that need to discuss HR matters — onboarding a new hire, confirming a role change, or coordinating leave schedules — are forced to switch to external tools such as Slack, Microsoft Teams, or email. Each context switch introduces friction, fragments the conversation history away from the relevant record, and requires employees to maintain separate identities and credentials across systems.

A first-class, in-app chat feature would allow HR staff and employees to communicate in context, directly alongside the records they are discussing.

### 1.2 Current Pain Points

- **Context switching**: Employees leave the app to communicate, creating a disjointed workflow.
- **Fragmented history**: Conversations about an employee's record live in external tools with no link back to the record.
- **No audit trail**: External chat platforms provide no correlated audit log of record changes and related conversations.
- **Data sovereignty**: Sensitive HR discussions sent through third-party SaaS platforms may violate data residency or privacy requirements.
- **Access management overhead**: Maintaining two separate user rosters (EMS and a chat platform) creates synchronisation burden.

### 1.3 Goals

- Deliver real-time, bidirectional messaging between authenticated employees.
- Persist full message history in a durable, queryable store (PostgreSQL).
- Support **10,000 concurrent users** via a horizontally scalable WebSocket architecture.
- Protect message content with **end-to-end encryption (E2E)**: the server stores and routes only ciphertext; plaintext never leaves the originating device.
- Integrate seamlessly with the existing React + Express codebase with minimal disruption to the current CRUD feature.

> **Prerequisite — Authentication**: The existing EMS has no authentication layer (see DESIGN.md §6.1). The chat feature requires a JWT-based auth system (§6.4) to be in place **and back-ported to the existing `/api/employees` endpoints** before deployment. This is a hard dependency, not an add-on.

### 1.4 Non-Goals

- Voice or video calling.
- File/image attachment support (deferred to a future iteration).
- Threaded / reply-to-message conversations (out of scope for v1).
- Push notifications to mobile devices (deferred; browser notifications only in v1).
- Fully federated or cross-organisation messaging.

---

## 2. Proposed Solution

A WebSocket-based real-time messaging layer bolted onto the existing two-tier application, with PostgreSQL for durable message storage and client-side end-to-end encryption using the **TweetNaCl** (libsodium-compatible) library.

### 2.1 Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| WebSocket library | `ws` (raw Node.js library) | Minimal overhead; full control over framing and message routing; no fallback machinery needed (all modern browsers support WS natively) |
| Real-time fan-out (multi-instance) | **Redis Pub/Sub** | Sub-millisecond in-process message fan-out across Node.js instances; operationally simpler than Kafka at the 10,000 user scale |
| Message persistence | **PostgreSQL** | Consistent with the existing app's migration roadmap (see DESIGN.md §9.1); ACID guarantees; rich query support for message history pagination |
| End-to-end encryption | **TweetNaCl / libsodium** (`tweetnacl` npm package) | Audited, widely deployed, small bundle (~30 KB); exposes X25519 Diffie–Hellman and XSalsa20-Poly1305 AEAD; simpler integration than the full Signal Protocol stack while still providing forward secrecy via per-session ephemeral keys |
| Authentication | **JWT** (access + refresh token pair) | Stateless; compatible with WebSocket upgrade handshake; enables short-lived tokens without a session store |
| Connection load balancing | **Sticky sessions** (IP hash) at the load balancer | Ensures a WebSocket connection always returns to the same Node.js instance; Redis pub/sub handles cross-instance message delivery |

### 2.2 Architecture Overview

| Tier | Technology | Role |
|------|-----------|------|
| **Frontend** | React 19 + Vite SPA | Chat UI; E2E encrypt/decrypt; WebSocket client |
| **WebSocket Server** | Node.js + `ws` library | WebSocket upgrade; room management; message routing via Redis |
| **REST API** | Node.js + Express 5 (existing) | Key bundle storage/retrieval; room CRUD; paginated message history |
| **Pub/Sub Broker** | Redis 7 (Pub/Sub mode) | Cross-instance message fan-out |
| **Message Store** | PostgreSQL 16 | Durable, encrypted ciphertext persistence; message history queries |
| **Key Server** | Express route (`/api/chat/keys`) | Public key bundle upload and retrieval; no private key material ever stored |

---

## 3. System Architecture

### 3.1 High-Level Architecture

```mermaid
graph TD
    subgraph Client["Client (Browser)"]
        SPA["React SPA\n(ChatPanel, encryption.js)"]
    end

    subgraph LB["Load Balancer\n(sticky sessions / IP hash)"]
        NLB["nginx / AWS ALB"]
    end

    subgraph WS_Cluster["WebSocket Server Cluster"]
        WS1["WS Server 1\n(Node.js :3002)"]
        WS2["WS Server 2\n(Node.js :3002)"]
        WS3["WS Server 3\n(Node.js :3002)"]
        WS4["WS Server 4\n(Node.js :3002)"]
    end

    subgraph Infra["Infrastructure"]
        Redis["Redis 7\n(Pub/Sub + Presence)"]
        PG["PostgreSQL 16\n(messages, rooms, keys)"]
    end

    SPA -- "WSS upgrade\n+ JWT auth" --> NLB
    NLB -- "sticky route" --> WS1
    NLB -- "sticky route" --> WS2
    NLB -- "sticky route" --> WS3
    NLB -- "sticky route" --> WS4

    WS1 -- "PUBLISH / SUBSCRIBE\nchat:room:<id>" --> Redis
    WS2 -- "PUBLISH / SUBSCRIBE\nchat:room:<id>" --> Redis
    WS3 -- "PUBLISH / SUBSCRIBE\nchat:room:<id>" --> Redis
    WS4 -- "PUBLISH / SUBSCRIBE\nchat:room:<id>" --> Redis

    WS1 -- "INSERT ciphertext\nSELECT history" --> PG
    WS2 -- "INSERT ciphertext\nSELECT history" --> PG
```

### 3.2 WebSocket Message Flow

The following sequence shows a message from Alice (connected to WS Server 1) being delivered to Bob (connected to WS Server 2), illustrating cross-instance fan-out via Redis Pub/Sub and the encryption boundary.

```mermaid
sequenceDiagram
    participant AB as Alice's Browser
    participant WS1 as WS Server 1
    participant R as Redis Pub/Sub
    participant WS2 as WS Server 2
    participant BB as Bob's Browser

    Note over AB: Alice composes message
    AB->>AB: Encrypt plaintext with<br/>Bob's shared secret (NaCl box)
    AB->>WS1: WS frame: send_message<br/>{roomId, ciphertext, nonce, senderPublicKey}
    WS1->>WS1: Validate JWT, parse envelope
    WS1->>WS1: INSERT INTO messages<br/>(ciphertext, nonce, room_id, sender_id)
    WS1->>R: PUBLISH chat:room:<roomId><br/>serialised envelope
    R-->>WS1: (fan-out to own subscribers)
    R-->>WS2: Fan-out: message_received envelope
    WS2->>WS2: Identify Bob's open WS connection
    WS2->>BB: WS frame: message_received<br/>{ciphertext, nonce, senderPublicKey, messageId, timestamp}
    BB->>BB: Derive shared secret from<br/>senderPublicKey + own private key
    BB->>BB: Decrypt ciphertext → plaintext
    Note over BB: Bob reads the message
```

### 3.3 End-to-End Encryption Key Exchange

Key exchange follows the **X3DH (Extended Triple Diffie–Hellman)** handshake pattern, after which the Double Ratchet algorithm maintains forward secrecy for subsequent messages. Private keys are generated in the browser and never transmitted.

```mermaid
sequenceDiagram
    participant A as Alice's Browser
    participant KS as Key Server<br/>(POST /api/chat/keys)
    participant B as Bob's Browser

    Note over A: On first login / key rotation
    A->>A: Generate identity keypair (IK_A)<br/>Generate signed pre-key (SPK_A)<br/>Generate one-time pre-keys (OPK_A[])
    A->>KS: POST /api/chat/keys<br/>{identityKey, signedPreKey,<br/>signedPreKeySig, oneTimePreKeys[]}
    KS-->>A: 201 Created (public keys only stored)

    Note over B: Bob wants to message Alice
    B->>KS: GET /api/chat/keys/alice<br/>(fetch Alice's key bundle)
    KS-->>B: {IK_A, SPK_A, signedPreKeySig, OPK_A}
    B->>B: Verify SPK_A signature with IK_A
    B->>B: Generate ephemeral keypair (EK_B)
    B->>B: X3DH: derive shared secret S from<br/>DH(IK_B, SPK_A) ⊕ DH(EK_B, IK_A)<br/>⊕ DH(EK_B, SPK_A) ⊕ DH(EK_B, OPK_A)
    B->>B: Initialise Double Ratchet with S
    B->>A: send_message {ciphertext, nonce,<br/>EK_B (public), usedOPK_A id}

    Note over A: Alice receives first message
    A->>A: Reconstruct DH inputs using<br/>own private keys + EK_B
    A->>A: Derive same shared secret S
    A->>A: Decrypt ciphertext → plaintext
    Note over A,B: Subsequent messages use<br/>Double Ratchet — forward secrecy<br/>maintained per message
```

### 3.4 Database Schema

```mermaid
erDiagram
    users {
        uuid id PK
        varchar email UK
        varchar display_name
        timestamptz created_at
        timestamptz updated_at
    }

    chat_rooms {
        uuid id PK
        varchar name
        varchar room_type
        uuid created_by FK
        timestamptz created_at
    }

    room_members {
        uuid room_id FK
        uuid user_id FK
        timestamptz joined_at
        timestamptz last_read_at
    }

    messages {
        uuid id PK
        uuid room_id FK
        uuid sender_id FK
        text ciphertext
        text nonce
        text sender_ephemeral_public_key
        timestamptz created_at
    }

    user_key_bundles {
        uuid id PK
        uuid user_id FK
        text identity_public_key
        text signed_pre_key
        text signed_pre_key_signature
        jsonb one_time_pre_keys
        timestamptz uploaded_at
        timestamptz expires_at
    }

    users ||--o{ chat_rooms : "creates"
    users ||--o{ room_members : "participates in"
    chat_rooms ||--o{ room_members : "has"
    chat_rooms ||--o{ messages : "contains"
    users ||--o{ messages : "sends"
    users ||--|| user_key_bundles : "owns"
```

---

## 4. Component Breakdown and Responsibilities

### 4.1 Frontend Components

| File | Responsibility |
|------|---------------|
| `src/components/ChatPanel.jsx` | Top-level chat shell; manages room selection state; renders `MessageList` and `MessageInput`; connects/disconnects the WebSocket via `useWebSocket` hook |
| `src/components/MessageList.jsx` | Virtualised scrollable list of decrypted messages; triggers paginated history fetch when scrolled to the top; renders sender, timestamp, and decrypted plaintext |
| `src/components/MessageInput.jsx` | Controlled textarea with send button; invokes `encryption.js` to produce ciphertext before handing the envelope to the WebSocket; emits `user_typing` events on keypress |
| `src/hooks/useWebSocket.js` | Custom React hook that owns the `WebSocket` instance lifecycle; handles connect, reconnect with exponential back-off, authentication handshake (JWT in query param), inbound message dispatch, and graceful close |
| `src/crypto/encryption.js` | Thin wrapper over the `tweetnacl` library; exposes `generateKeyPair()`, `encryptMessage(plaintext, recipientPublicKey, senderSecretKey)`, `decryptMessage(ciphertext, nonce, senderPublicKey, recipientSecretKey)`, and `deriveSharedSecret()`; private keys stored in `sessionStorage` (never in localStorage or transmitted) |
| `src/api.js` (updated) | Extended with `getChatRooms()`, `createChatRoom()`, `getMessageHistory(roomId, cursor)`, `uploadKeyBundle(bundle)`, `getKeyBundle(userId)` helper functions |

### 4.2 Backend Components

| File | Responsibility |
|------|---------------|
| `server/chat.js` | WebSocket upgrade handler; authenticates JWT on upgrade; manages per-room subscription sets; receives inbound `send_message` frames, persists ciphertext to PostgreSQL, and publishes to Redis; routes inbound Redis messages to the correct connected clients; handles `join_room`, `leave_room`, `user_typing` events; emits heartbeat pings every `WS_HEARTBEAT_INTERVAL_MS` |
| `server/db.js` | PostgreSQL connection pool (using `pg` / node-postgres); exposes typed query helpers: `insertMessage()`, `getMessageHistory()`, `getRooms()`, `getRoomMembers()`; integrates with PgBouncer in production |
| `server/keyServer.js` | Express router mounted at `/api/chat/keys`; stores and retrieves public key bundles; validates bundle structure (required fields, base64 encoding); consumes one-time pre-keys atomically (SELECT + DELETE in a transaction) to prevent reuse |
| `server/redisClient.js` | Initialises two `ioredis` client instances (publisher + subscriber); exports `publish(channel, payload)` and `subscribe(channel, handler)` helpers; subscriber client handles Redis reconnection |
| `server/middleware/auth.js` | Express middleware and WebSocket handshake validator; verifies HS256 JWT signature, expiry, and `sub` claim; attaches `req.user` for downstream handlers |

### 4.3 Infrastructure Components

| Component | Role |
|-----------|------|
| **Redis 7 (Pub/Sub)** | Channel-per-room fan-out (`chat:room:<uuid>`); presence heartbeat channel (`chat:presence`); no message durability required — PostgreSQL owns persistence |
| **PostgreSQL 16** | Sole durable store for encrypted message ciphertext, room metadata, membership, and public key bundles; partitioned `messages` table by month |
| **PgBouncer** (production) | Connection pooler in transaction-mode sitting between the Node.js cluster and PostgreSQL; keeps active DB connections at ≤ 100 regardless of WS server count |
| **nginx / AWS ALB** | TLS termination (WSS); sticky sessions via IP hash or cookie; HTTP/2 for REST endpoints; WebSocket upgrade pass-through |

---

## 5. API Design and Data Models

### 5.1 WebSocket Message Envelope

All WebSocket frames carry a JSON envelope. The server routes based on `type` and `roomId` only; it never inspects or logs `ciphertext`.

```json
{
  "type": "send_message",
  "messageId": "01932f4a-7c3e-7b1d-9a2e-4f8d3c2b1a0e",
  "roomId": "01932f4a-0000-7b1d-0000-4f8d3c2b1a0e",
  "ciphertext": "<base64-encoded XSalsa20-Poly1305 ciphertext>",
  "nonce": "<base64-encoded 24-byte random nonce>",
  "senderPublicKey": "<base64-encoded X25519 ephemeral public key>",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Event type (see §5.2) |
| `messageId` | UUIDv7 | Client-generated stable ID; used for deduplication and delivery acknowledgement |
| `roomId` | UUID | Target chat room identifier |
| `ciphertext` | base64 string | NaCl `box` output; opaque to the server |
| `nonce` | base64 string | 24-byte random nonce used for this message; must not be reused |
| `senderPublicKey` | base64 string | Sender's ephemeral X25519 public key for this session's ratchet step |
| `timestamp` | ISO 8601 | Client-side send timestamp; server records its own `created_at` independently |

### 5.2 WebSocket Event Types

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_room` | Client → Server | Subscribe to a room's message stream; server validates membership |
| `leave_room` | Client → Server | Unsubscribe from a room |
| `send_message` | Client → Server | Deliver an encrypted message envelope to a room |
| `message_received` | Server → Client | Fan-out of a `send_message` to all room members |
| `user_typing` | Client → Server | Notify room that the sender is composing; not persisted |
| `user_joined` | Server → Client | Broadcast when a room member connects |
| `user_left` | Server → Client | Broadcast when a room member disconnects |
| `ack` | Server → Client | Delivery acknowledgement; contains `messageId` and server-assigned `timestamp` |
| `error` | Server → Client | Error response; contains `code` (string) and `message` (human-readable) |

### 5.3 REST Endpoints for Chat

These endpoints complement the WebSocket channel for operations that are request/response by nature (room management, history retrieval, key exchange).

| Method | Path | Description | Auth | Success | Error |
|--------|------|-------------|------|---------|-------|
| `GET` | `/api/chat/rooms` | List rooms the authenticated user belongs to | JWT required | `200 []` | `401` |
| `POST` | `/api/chat/rooms` | Create a new chat room | JWT required | `201 {}` | `400` / `401` |
| `GET` | `/api/chat/rooms/:id/messages` | Paginated encrypted message history (`?cursor=<messageId>&limit=50`) | JWT required | `200 { messages[], nextCursor }` | `403` / `404` |
| `GET` | `/api/chat/keys/:userId` | Retrieve a user's public key bundle (consumes one OPK atomically) | JWT required | `200 {}` | `404` |
| `POST` | `/api/chat/keys` | Upload or refresh own key bundle | JWT required | `201 {}` | `400` / `401` |
| `POST` | `/api/auth/token` | Exchange credentials for JWT access + refresh tokens | Public | `200 { accessToken, refreshToken }` | `401` |
| `POST` | `/api/auth/refresh` | Exchange refresh token for a new access token | Refresh JWT | `200 { accessToken }` | `401` |

### 5.4 PostgreSQL Data Models

Full DDL for all five tables, including indexes and partitioning strategy.

```sql
-- ─────────────────────────────────────────
-- Users (shadow table; mirrors EMS employees)
-- ─────────────────────────────────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    display_name  VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Chat Rooms
-- ─────────────────────────────────────────
CREATE TABLE chat_rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    room_type   VARCHAR(20)  NOT NULL CHECK (room_type IN ('direct', 'group')),
    created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Room Membership
-- ─────────────────────────────────────────
CREATE TABLE room_members (
    room_id      UUID        NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX idx_room_members_user_id ON room_members (user_id);

-- ─────────────────────────────────────────
-- Messages (append-only; range-partitioned by month)
-- ─────────────────────────────────────────
CREATE TABLE messages (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid(),
    room_id                     UUID        NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id                   UUID        NOT NULL REFERENCES users(id)      ON DELETE SET NULL,
    ciphertext                  TEXT        NOT NULL,
    nonce                       TEXT        NOT NULL,
    sender_ephemeral_public_key TEXT        NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at),
    CONSTRAINT uq_messages_nonce UNIQUE (nonce)
) PARTITION BY RANGE (created_at);

-- Monthly partitions (create programmatically; shown here for illustration)
CREATE TABLE messages_2025_01 PARTITION OF messages
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE messages_2025_02 PARTITION OF messages
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- Composite index for paginated history queries
CREATE INDEX idx_messages_room_created ON messages (room_id, created_at DESC);
-- Index for per-user message lookup
CREATE INDEX idx_messages_sender      ON messages (sender_id, created_at DESC);

-- ─────────────────────────────────────────
-- User Key Bundles (public keys only)
-- ─────────────────────────────────────────
CREATE TABLE user_key_bundles (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    identity_public_key      TEXT        NOT NULL,
    signed_pre_key           TEXT        NOT NULL,
    signed_pre_key_signature TEXT        NOT NULL,
    one_time_pre_keys        JSONB       NOT NULL DEFAULT '[]',
    uploaded_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at               TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX idx_key_bundles_user_id    ON user_key_bundles (user_id);
CREATE INDEX idx_key_bundles_expires_at ON user_key_bundles (expires_at);
```

---

## 6. Security Considerations

### 6.1 End-to-End Encryption Design

Messages are encrypted on the **sender's device** before being transmitted to the server. The server stores only opaque ciphertext alongside the nonce and the sender's ephemeral public key — never the plaintext.

- **Initial key agreement**: X3DH (Extended Triple Diffie–Hellman) establishes a shared secret between two parties using long-term identity keys, medium-term signed pre-keys, and one-time pre-keys. This provides **deniability** and **forward secrecy** even if the server is fully compromised.
- **Ongoing messaging**: After the initial handshake, the **Double Ratchet** algorithm advances the key material with every message. Compromise of any single message key does not expose past or future messages (**forward secrecy** + **break-in recovery**).
- **Primitive choices**: X25519 for Diffie–Hellman, XSalsa20-Poly1305 for authenticated encryption (via TweetNaCl's `nacl.box`), and Ed25519 for signing pre-keys. All are standardised, widely audited, and available in the `tweetnacl` npm package.
- **Private key storage**: Private keys are generated in the browser at login time and held only in `sessionStorage` for the duration of the session. They are never serialised to `localStorage`, cookies, or transmitted over the network. On session end they are overwritten with zeroed bytes.

### 6.2 Key Management

| Key Type | Lifetime | Rotation Trigger |
|----------|----------|-----------------|
| Identity key (IK) | Long-term (~1 year) | Manual revocation or compromise |
| Signed pre-key (SPK) | Medium-term (30 days, configurable via `ENCRYPTION_KEY_ROTATION_DAYS`) | Automatic on login if current key has expired. If a sender fetches a key bundle immediately before the SPK expires, the server returns the existing SPK until the recipient next logs in. To prevent delivery failures during this gap, the server retains the previous SPK for 48 hours after rotation as a fallback, and the sender's `useWebSocket` hook retries with a fresh key bundle on receipt of an `error` event with code `4030` (key bundle stale). |
| One-time pre-keys (OPK) | Single use | Consumed atomically on first use; client uploads a fresh batch when the server signals low supply (< 5 remaining) |
| Ephemeral session key | Per Double Ratchet step | Derived fresh for every message |

Key bundles (containing only the public halves of all key types) are stored in the `user_key_bundles` table and accessible via `GET /api/chat/keys/:userId`. The server enforces that OPKs are consumed at most once by performing the SELECT and DELETE within a single serialisable transaction.

### 6.3 Transport Security

- All WebSocket connections are **WSS** (WebSocket Secure), upgrading from HTTPS connections only. Plaintext `ws://` is rejected at the load balancer.
- TLS **1.3 only**; TLS 1.2 and below disabled at the load balancer and nginx configuration.
- HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) applied to all HTTP responses.
- Certificate pinning is out of scope for a browser-based client but recommended for any native clients in future iterations.

### 6.4 Authentication

- **Access token**: HS256 JWT; `exp` set to **15 minutes**; claims: `sub` (user UUID), `email`, `iat`, `exp`.
- **Refresh token**: Long-lived (7 days); stored as an `HttpOnly`, `Secure`, `SameSite=Strict` cookie; rotated on each use.
- **WebSocket handshake**: The access token is passed as the `Authorization: Bearer <token>` header during the HTTP upgrade request. If the WebSocket client cannot set headers (browser `WebSocket` API limitation), the token is accepted as the `token` query parameter for the initial upgrade only, then immediately discarded server-side. **Security note**: query-parameter tokens appear in server access logs, proxy logs, and browser history — this fallback must only be used as a last resort, and server-side log redaction rules must strip the `token` parameter from all access logs. Prefer using a WebSocket library (e.g. via a `fetch`-based upgrade polyfill) that supports custom headers to avoid this exposure. |
- **Token renewal**: The `useWebSocket` hook monitors token expiry and triggers a silent refresh via `/api/auth/refresh` approximately 60 seconds before expiry, without interrupting the active WebSocket connection.

### 6.5 Rate Limiting

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Messages per user per minute | 60 | In-memory token bucket per `userId` in `server/chat.js`; violation closes the connection with code `4029` |
| WebSocket connection attempts per IP per minute | 20 | `express-rate-limit` middleware on the `/upgrade` path |
| REST API requests per IP per minute | 100 | `express-rate-limit` on all `/api/*` routes |
| Key bundle fetch per user per hour | 200 | Prevents enumeration of OPKs |
| Message payload size | Configurable via `WS_MAX_PAYLOAD_BYTES` (default: 64 KB) | Enforced by `ws` library `maxPayload` option |

**Custom WebSocket close codes** (application-specific range 4000–4999):

| Code | Name | Meaning |
|------|------|---------|
| `4000` | `GENERIC_ERROR` | Unclassified server error; client should reconnect with back-off |
| `4001` | `AUTH_REQUIRED` | WebSocket upgrade attempted without a valid JWT |
| `4002` | `AUTH_EXPIRED` | JWT expired during the session; client must refresh the token and reconnect |
| `4003` | `FORBIDDEN` | Authenticated user is not a member of the requested room |
| `4029` | `RATE_LIMITED` | User exceeded the per-minute message rate limit; client must wait before reconnecting |
| `4030` | `KEY_BUNDLE_STALE` | Recipient's key bundle has been rotated; sender must fetch a fresh bundle before retrying |
| `4040` | `ROOM_NOT_FOUND` | The requested `roomId` does not exist or has been deleted |
| `4410` | `GONE` | Server instance is shutting down gracefully; client should reconnect to another instance |

### 6.6 Threat Model

| Threat | Attack Vector | Mitigation |
|--------|--------------|-----------|
| **Server compromise** | Attacker gains full DB access | E2E encryption; server stores only ciphertext + nonces; no plaintext recoverable without client private keys |
| **Man-in-the-middle** | Network interception | WSS over TLS 1.3; HSTS; certificate transparency monitoring |
| **Replay attacks** | Retransmit a valid message frame | Per-message random 24-byte nonce; server rejects duplicate `messageId` (UUIDv7 with embedded timestamp) |
| **Spam / flooding** | High-volume message injection | Per-user rate limiting (60 msg/min); connection-level rate limiting; payload size cap |
| **Key bundle poisoning** | Upload malicious public keys to impersonate a user | SPK signature verified by recipient against IK; identity key continuity checked on subsequent logins |
| **Token theft** | XSS reads token from JavaScript | Access token in memory only (not `localStorage`); refresh token in `HttpOnly` cookie; short access token lifetime (15 min) |
| **Brute-force auth** | Repeated login attempts | Rate limiting on `/api/auth/token`; account lockout after 10 failed attempts (deferred to auth service) |
| **Insider threat (server admin)** | Admin reads stored messages | Impossible without client private keys; E2E design ensures zero-knowledge server |

### 6.7 Comparison with the Existing Application

> **Important**: The existing EMS (see DESIGN.md §6.1) has **no authentication layer** — all REST endpoints are public. The chat feature introduces authentication as a **foundational requirement**, not an add-on. The JWT-based auth system described in §6.4 must also be back-ported to protect the existing `/api/employees` endpoints before the chat feature is deployed to production. Operating a mixed authenticated/unauthenticated API surface on the same origin would create a security boundary inconsistency.

---

## 7. Performance Requirements

### 7.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Message delivery latency (p50) | < 50 ms | Sender → recipient, same region |
| Message delivery latency (p95) | < 200 ms | Including cross-instance Redis fan-out |
| Message delivery latency (p99) | < 500 ms | Tail latency under peak load |
| WebSocket connection establishment | < 300 ms | Including TLS handshake and JWT validation |
| Messages per second (aggregate) | ≥ 5,000 msg/s | Across all WS server instances |
| Concurrent connections per Node.js instance | 2,500–3,000 | At ≤ 70 % CPU; above this, scale out |
| PostgreSQL write throughput | ≥ 3,000 INSERT/s | With PgBouncer pooling; NVMe-backed storage |
| Redis Pub/Sub fan-out latency | < 5 ms | Local network; single Redis node |
| Message history query (50 messages, cursor-paginated) | < 50 ms | Index-only scan on `(room_id, created_at DESC)` |

### 7.2 Scaling to 10,000 Concurrent Users

Each Node.js process can sustain approximately **2,500–3,000 simultaneous WebSocket connections** at comfortable CPU utilisation (≤ 70 %) on a 2-vCPU / 4 GB node, given:

- Majority of connections are idle at any moment (typical chat traffic is bursty).
- Each connection consumes ~15–25 KB heap overhead.
- Redis pub/sub dispatch is non-blocking and uses a separate `ioredis` subscriber client per instance.

**Capacity plan for 10,000 concurrent users:**

| Dimension | Value |
|-----------|-------|
| WS server instances required | 4 (2,500 connections/instance × 4 = 10,000) |
| Headroom buffer (×1.25) | 5 instances recommended |
| HPA trigger | Scale out when CPU > 65 % OR connections > 2,000 per pod |
| Redis connections (2 per WS instance: pub + sub) | 10 total |
| PostgreSQL connections via PgBouncer | ≤ 100 server-side connections regardless of WS instance count |

**Cross-instance message delivery**: When Alice (on WS Server 1) sends a message to a room where Bob (on WS Server 2) is connected, WS Server 1 publishes to the Redis channel `chat:room:<roomId>`. Every WS server instance subscribes to that channel and fans the message out to any locally-connected members. This ensures correct delivery without any direct instance-to-instance communication.

**Sticky session requirement**: The load balancer must route each client's WebSocket upgrade — and all subsequent frames — to the **same WS server instance**. IP-hash or cookie-based affinity achieves this. Sticky sessions are only required for the WebSocket connection; REST API requests are stateless and need no affinity.

### 7.3 Database Performance

- **Append-only write pattern**: The `messages` table receives only `INSERT` operations. There are no `UPDATE` or `DELETE` operations on message rows in the hot path, enabling `FILLFACTOR = 100` for maximum storage density.
- **Time-series partitioning**: Monthly range partitions on `created_at` allow old partition files to be archived to cold storage (e.g. S3 via `pg_partman`) without affecting query performance on recent data.
- **Composite index**: `(room_id, created_at DESC)` covers the dominant query pattern — paginated history for a room ordered newest-first — as an index-only scan.
- **Read replicas**: Message history queries (`GET /api/chat/rooms/:id/messages`) are routed to a PostgreSQL streaming replica, reducing read load on the primary. The primary handles only writes (new messages, OPK consumption).
- **PgBouncer**: Operates in **transaction mode**, allowing the WS server cluster to maintain a large number of idle application-level connections without exhausting PostgreSQL's `max_connections`.

### 7.4 Horizontal Scaling Diagram

```mermaid
graph LR
    Client["Clients\n(10,000 browsers)"]
    LB["Load Balancer\n(sticky sessions)"]

    subgraph WS["WebSocket Server Cluster (auto-scaled)"]
        WS1["WS Server 1\n~2,500 conns"]
        WS2["WS Server 2\n~2,500 conns"]
        WS3["WS Server 3\n~2,500 conns"]
        WS4["WS Server 4\n~2,500 conns"]
    end

    subgraph Cache["Redis Cluster"]
        R1["Redis Primary"]
        R2["Redis Replica"]
    end

    subgraph DB["PostgreSQL"]
        PG_PRI["PostgreSQL Primary\n(writes)"]
        PG_R1["Read Replica 1\n(history queries)"]
        PG_R2["Read Replica 2\n(history queries)"]
        PGB["PgBouncer\n(connection pool)"]
    end

    Client --> LB
    LB --> WS1
    LB --> WS2
    LB --> WS3
    LB --> WS4

    WS1 --> R1
    WS2 --> R1
    WS3 --> R1
    WS4 --> R1
    R1 --> R2

    WS1 --> PGB
    WS2 --> PGB
    WS3 --> PGB
    WS4 --> PGB

    PGB --> PG_PRI
    PGB --> PG_R1
    PGB --> PG_R2

    PG_PRI -- "streaming replication" --> PG_R1
    PG_PRI -- "streaming replication" --> PG_R2
```

---

## 8. Deployment Strategy

### 8.1 Docker Compose (Development)

The following `docker-compose.yml` runs a complete local development stack with hot-reload for the Node.js WS server.

```yaml
version: "3.9"

services:
  ws-server:
    build:
      context: .
      dockerfile: Dockerfile.server
    ports:
      - "3001:3001"   # REST API (existing)
      - "3002:3002"   # WebSocket server
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://ems:ems_dev_pass@postgres:5432/ems_chat
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-jwt-secret-change-in-production
      JWT_REFRESH_SECRET: dev-refresh-secret-change-in-production
      ENCRYPTION_KEY_ROTATION_DAYS: "30"
      WS_MAX_PAYLOAD_BYTES: "65536"
      WS_HEARTBEAT_INTERVAL_MS: "30000"
      RATE_LIMIT_MESSAGES_PER_MINUTE: "60"
    volumes:
      - ./server:/app/server   # live reload
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ems
      POSTGRES_PASSWORD: ems_dev_pass
      POSTGRES_DB: ems_chat
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./server/db/schema.sql:/docker-entrypoint-initdb.d/01_schema.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ems -d ems_chat"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --save "" --appendonly no
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres_data:
```

> **Development note**: The `ws-server` service mounts the local `./server` directory for live code reloading via `nodemon`. The Vite dev server (`npm run dev`) continues to run on the host at `:5173` and proxies `/api` to `:3001` and `/ws` to `:3002` as configured in `vite.config.js`.

### 8.2 Production Kubernetes

The chat WebSocket server is deployed as a separate Kubernetes `Deployment` from the existing Express REST API, allowing each to scale independently.

```yaml
# ws-server-deployment.yaml (abbreviated)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ems-ws-server
spec:
  # replicas omitted — managed by HorizontalPodAutoscaler (minReplicas: 4)
  selector:
    matchLabels:
      app: ems-ws-server
  template:
    spec:
      containers:
        - name: ws-server
          image: registry.example.com/ems-ws-server:latest
          ports:
            - containerPort: 3002
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits:   { cpu: "1000m", memory: "1Gi" }
          envFrom:
            - secretRef: { name: ems-chat-secrets }
            - configMapRef: { name: ems-chat-config }
---
apiVersion: v1
kind: Service
metadata:
  name: ems-ws-server
spec:
  type: ClusterIP
  selector:
    app: ems-ws-server
  ports:
    - port: 3002
      targetPort: 3002
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ems-ws-server-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ems-ws-server
  minReplicas: 4
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
```

**Key production decisions:**
- Redis is provisioned as a **managed service** (AWS ElastiCache for Redis or Redis Cloud) rather than a self-managed pod, to benefit from automatic failover, encryption at rest, and managed patching.
- PostgreSQL is provisioned as **AWS RDS for PostgreSQL** (Multi-AZ) or **Cloud SQL**, with automated backups and a read replica in the same region.
- WebSocket affinity is achieved via the `nginx.ingress.kubernetes.io/upstream-hash-by: "$remote_addr"` annotation on the Kubernetes Ingress, or AWS ALB's sticky session target group attribute.

### 8.3 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | _(required)_ | PostgreSQL connection string (`postgres://user:pass@host:5432/db`) |
| `REDIS_URL` | _(required)_ | Redis connection URL (`redis://host:6379` or `rediss://` for TLS) |
| `JWT_SECRET` | _(required)_ | HMAC-SHA256 secret for signing access tokens; minimum 32 random bytes |
| `JWT_REFRESH_SECRET` | _(required)_ | Separate secret for refresh tokens; must differ from `JWT_SECRET` |
| `ENCRYPTION_KEY_ROTATION_DAYS` | `30` | Days after which signed pre-keys are considered stale and rotation is prompted |
| `WS_MAX_PAYLOAD_BYTES` | `65536` | Maximum WebSocket frame payload size in bytes; frames exceeding this are rejected |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | Interval (ms) between server-sent WebSocket ping frames; clients not responding within 2× this value are disconnected |
| `RATE_LIMIT_MESSAGES_PER_MINUTE` | `60` | Maximum messages a single user may send per minute; excess triggers a `4029` close |
| `PORT` | `3001` | Express REST API port (unchanged from existing app) |
| `WS_PORT` | `3002` | WebSocket server port |
| `PG_POOL_MAX` | `20` | Maximum PostgreSQL connections per WS server instance (before PgBouncer) |

### 8.4 CI/CD Pipeline

```mermaid
graph LR
    Push["Git push\n(feature branch)"]
    GHA["GitHub Actions\nWorkflow"]
    Lint["Lint\n(ESLint + tsc)"]
    Test["Unit + Integration\nTests (Vitest + Supertest)"]
    Build["Vite Build\n+ esbuild server"]
    Docker["Docker Build\n& Tag"]
    Registry["Push to\nContainer Registry\n(GHCR / ECR)"]
    Staging["Deploy to\nStaging\n(k8s apply)"]
    E2E["E2E Tests\n(Playwright)"]
    Prod["Deploy to\nProduction\n(k8s rollout)"]

    Push --> GHA
    GHA --> Lint
    GHA --> Test
    GHA --> Build
    Lint --> Docker
    Test --> Docker
    Build --> Docker
    Docker --> Registry
    Registry --> Staging
    Staging --> E2E
    E2E -->|"All tests pass"| Prod
```

> Deployments to production require all three gate stages (lint, tests, E2E) to pass and are gated behind a manual approval step for the `main` branch. Docker images are tagged with the Git commit SHA and a semantic version label. Rollback is achieved via `kubectl rollout undo`.

---

## 9. Trade-offs and Alternatives Considered

### 9.1 WebSocket vs. SSE vs. Long-Polling

| Criterion | WebSocket | Server-Sent Events (SSE) | Long-Polling |
|-----------|-----------|--------------------------|--------------|
| **Latency** | Very low (full-duplex, persistent) | Low (server-push only) | High (one round-trip per message) |
| **Bidirectionality** | Full-duplex | Server → Client only; client uses separate HTTP | Half-duplex (client polls) |
| **Implementation complexity** | Medium | Low | Low |
| **Browser support** | Universal (all modern browsers) | Universal | Universal |
| **HTTP/2 proxy compatibility** | Requires upgrade handling; some proxies block | Works natively with HTTP/2 | Works natively |
| **Server resource usage** | Persistent connection per client | Persistent connection per client | High (many concurrent requests) |
| **Reconnection** | Manual (or `ws` library handles) | Built-in `EventSource` auto-reconnect | Built-in |

**Decision**: WebSocket is the only option that naturally supports **bidirectional** real-time communication (typing indicators, presence, acknowledgements) without a supplementary HTTP channel. The added proxy complexity is mitigated by WSS-over-TLS-443, which passes through virtually all enterprise proxies.

### 9.2 Socket.IO vs. Raw `ws` Library

| Criterion | Socket.IO | Raw `ws` |
|-----------|-----------|----------|
| **Auto-reconnect** | Built-in with exponential back-off | Must implement in `useWebSocket` hook |
| **Rooms / namespaces** | Built-in abstraction | Manual implementation (Redis pub/sub handles this) |
| **Fallback transports** | Yes (polling → WebSocket) | No |
| **Protocol overhead** | ~50 byte framing overhead per message | Minimal (raw JSON only) |
| **Bundle size (client)** | ~45 KB gzip | ~10 KB (`tweetnacl`) |
| **Performance** | Slightly lower due to abstraction | Higher; direct control over message routing |
| **Debugging** | Rich dev tools | Standard WS inspector in browser DevTools |

**Decision**: Raw `ws` is preferred. The fallback transport in Socket.IO is unnecessary — all target browsers support WebSocket natively. The rooms/namespaces abstraction is replaced by Redis pub/sub channels, which also solves the multi-instance fan-out problem. The smaller overhead matters at 10,000 concurrent connections.

### 9.3 E2E Encryption: Signal Protocol vs. libsodium/NaCl vs. MLS

| Criterion | Signal Protocol (`libsignal`) | libsodium / TweetNaCl | MLS (Messaging Layer Security) |
|-----------|-------------------------------|-----------------------|-------------------------------|
| **Maturity** | Production-proven (Signal, WhatsApp, Wire) | Mature primitives; widely audited | RFC 9420 (2023); limited production deployments |
| **Group chat support** | Sender Keys (Signal) — scales to large groups with caveats | Manual fan-encrypt or shared group key | Native; designed for groups up to millions |
| **Implementation complexity** | High (`@signalapp/libsignal-client` ~4 MB WASM) | Low; minimal API surface | Very high; complex state machine |
| **Forward secrecy** | Yes (Double Ratchet) | Yes (per-session ephemeral keys + manual ratchet) | Yes (TreeKEM) |
| **Post-compromise security** | Yes (Double Ratchet healing) | Partial (manual ratchet step required) | Yes (TreeKEM healing) |
| **Browser bundle impact** | Large (~4 MB WASM) | Small (~30 KB) | Large; no mature browser library yet |

**Decision**: **libsodium / TweetNaCl** is chosen for v1. The bundle size and implementation complexity of the full Signal Protocol stack (`libsignal`) is disproportionate to the current group size requirements (small HR teams). TweetNaCl provides the core X25519 + XSalsa20-Poly1305 primitives needed to implement the X3DH handshake and a simplified Double Ratchet. Migration to MLS is noted as a future path if group sizes exceed ~100 members or post-compromise security guarantees need to be tightened.

### 9.4 Redis vs. Apache Kafka for Pub/Sub Fan-Out

| Criterion | Redis Pub/Sub | Apache Kafka |
|-----------|--------------|-------------|
| **Fan-out latency** | Sub-millisecond (in-memory) | 5–20 ms (disk-based batching) |
| **Message ordering** | Per-channel FIFO | Per-partition ordering |
| **Persistence / replay** | None (fire-and-forget) | Configurable retention (days to indefinitely) |
| **Operational complexity** | Low (single binary; managed via ElastiCache) | High (ZooKeeper/KRaft, broker cluster, topic management) |
| **At-scale throughput** | ~1 M messages/s per node | Millions/s with partitioning |
| **Suitable for** | ≤ 1 M messages/s; no replay needed | Event sourcing, audit logs, >1 M msg/s |

**Decision**: Redis Pub/Sub is chosen. PostgreSQL owns message durability, so Redis only needs to fan out live messages to connected instances — a task it performs with minimal latency and zero operational overhead compared to Kafka. At 10,000 concurrent users generating at most ~5,000 msg/s, Redis is not a bottleneck. Kafka would be revisited if the architecture evolved into an event-sourcing model or exceeded 100,000 msg/s.

### 9.5 PostgreSQL vs. Cassandra for Message Storage

| Criterion | PostgreSQL (chosen) | Apache Cassandra |
|-----------|---------------------|-----------------|
| **Write throughput** | High with PgBouncer + NVMe (≥ 3,000 INSERT/s per node) | Very high (append-optimised LSM tree; 10,000–100,000 writes/s) |
| **Query flexibility** | High (SQL, JOINs, window functions) | Limited (partition key + clustering column) |
| **Operational complexity** | Low (single primary; familiar tooling) | High (multi-node; tunable consistency; compaction) |
| **Consistency** | Strong (ACID) | Eventual by default (tunable) |
| **Existing ecosystem fit** | Consistent with DESIGN.md §9.1 migration path | Introduces a second database technology |
| **Horizontal write scaling** | Requires sharding or Citus | Native (multi-node by design) |

**Decision**: PostgreSQL is chosen to remain consistent with the existing application's planned migration path (DESIGN.md §9.1) and to avoid introducing a second database technology into the operational stack. At 10,000 users, PostgreSQL with PgBouncer and time-series partitioning comfortably handles the expected write throughput. Cassandra would be reconsidered if the write rate exceeded ~10,000 msg/s sustained or if global multi-region distribution became a requirement.

---

## 10. Success Metrics

| Category | Metric | Target |
|----------|--------|--------|
| **Functional** | Messages delivered end-to-end | 100 % of sent messages received by all online room members |
| **Functional** | Message ordering | Messages displayed in server `created_at` order; no re-ordering observed under concurrent load |
| **Functional** | No message loss | Zero messages dropped during a 24-hour soak test at 80 % peak load; verified by sender `messageId` reconciliation |
| **Functional** | History pagination | Full message history retrievable via cursor pagination with no gaps or duplicates |
| **Performance** | Delivery latency p95 | < 200 ms (sender to all online recipients, same region) |
| **Performance** | Concurrent connections sustained | 10,000 simultaneous WebSocket connections for ≥ 60 minutes without degradation |
| **Performance** | No message loss under load | Zero dropped messages at 5,000 msg/s aggregate throughput (load test) |
| **Performance** | Connection establishment | < 300 ms for WSS handshake + JWT validation at p95 |
| **Security** | E2E encryption verified | Zero plaintext message content stored in PostgreSQL; verified by direct DB inspection post-load-test |
| **Security** | No private key exfiltration | Static analysis and CSP headers confirm private keys are never attached to outbound network requests |
| **Security** | Nonce uniqueness | Zero nonce reuse detected across 10 M messages in load test (verified by DB uniqueness constraint) |
| **Security** | Rate limiting enforcement | Message rate limiter correctly blocks at 61 msg/min in integration tests |
| **Operational** | Uptime SLA | 99.9 % monthly uptime (≤ 43 minutes downtime/month) |
| **Operational** | Automatic failover | WS server pod replacement completes in < 30 seconds; connected clients reconnect transparently via `useWebSocket` back-off |
| **Operational** | Mean time to recovery (MTTR) | < 5 minutes from alert trigger to service restoration for P1 incidents |
| **Operational** | Key bundle availability | GET `/api/chat/keys/:userId` returns a valid bundle in < 50 ms at p95 |
| **Developer experience** | Local dev stack startup | `docker compose up` boots full stack (WS server + PostgreSQL + Redis) in < 60 seconds |
| **Developer experience** | Test coverage | ≥ 80 % line coverage across `server/chat.js`, `server/keyServer.js`, `src/crypto/encryption.js` |
