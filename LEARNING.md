# LEARNING.md — Everything Learned Building Finora

A complete reference of concepts, decisions, and hard-won lessons from building a full-stack personal finance tracker with Spring Boot, React, PostgreSQL (Supabase), and Railway deployment.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Java & Spring Boot Fundamentals](#2-java--spring-boot-fundamentals)
3. [Spring Data JPA & Hibernate](#3-spring-data-jpa--hibernate)
4. [Database Design & PostgreSQL](#4-database-design--postgresql)
5. [Flyway — Database Migrations](#5-flyway--database-migrations)
6. [REST API Design](#6-rest-api-design)
7. [Security — JWT Authentication](#7-security--jwt-authentication)
8. [Security — Field-Level Encryption & Vault](#8-security--field-level-encryption--vault)
9. [Security — Ledger Integrity & Tamper Detection](#9-security--ledger-integrity--tamper-detection)
10. [Spring Security Configuration](#10-spring-security-configuration)
11. [Rate Limiting](#11-rate-limiting)
12. [External APIs — Price Providers](#12-external-apis--price-providers)
13. [File Parsing — PDFBox & Apache POI](#13-file-parsing--pdfbox--apache-poi)
14. [Scheduled Tasks & Virtual Threads](#14-scheduled-tasks--virtual-threads)
15. [Maven — Build, Testing & Coverage](#15-maven--build-testing--coverage)
16. [Checkstyle — Code Quality](#16-checkstyle--code-quality)
17. [React & TypeScript Fundamentals](#17-react--typescript-fundamentals)
18. [React Context API — State Management](#18-react-context-api--state-management)
19. [Dual-Mode Architecture (Cloud vs Local Vault)](#19-dual-mode-architecture-cloud-vs-local-vault)
20. [WebCrypto API — Browser-Side Encryption](#20-webcrypto-api--browser-side-encryption)
21. [IndexedDB — Client-Side Persistence](#21-indexeddb--client-side-persistence)
22. [File System Access API](#22-file-system-access-api)
23. [Axios — HTTP Client & Interceptors](#23-axios--http-client--interceptors)
24. [Vite — Frontend Build Tool](#24-vite--frontend-build-tool)
25. [Tailwind CSS](#25-tailwind-css)
26. [Recharts — Data Visualisation](#26-recharts--data-visualisation)
27. [Excel & PDF Export in the Browser](#27-excel--pdf-export-in-the-browser)
28. [React Router v6](#28-react-router-v6)
29. [Docker & Docker Compose](#29-docker--docker-compose)
30. [Nginx — Reverse Proxy & SPA Serving](#30-nginx--reverse-proxy--spa-serving)
31. [Supabase — Managed PostgreSQL](#31-supabase--managed-postgresql)
32. [Railway — Cloud Deployment](#32-railway--cloud-deployment)
33. [Environment Variables & Secrets Management](#33-environment-variables--secrets-management)
34. [HikariCP — Connection Pooling](#34-hikaricp--connection-pooling)
35. [CompletableFuture — Parallel Async Work](#35-completablefuture--parallel-async-work)
36. [Design Patterns Used](#36-design-patterns-used)
37. [Testing Strategy](#37-testing-strategy)
38. [Makefile — Local CI Automation](#38-makefile--local-ci-automation)
39. [Common Pitfalls & Lessons Learned](#39-common-pitfalls--lessons-learned)

---

## 1. Project Overview

Finora is a personal finance tracker that operates in two modes:

**Cloud Mode**: The React SPA communicates with a Spring Boot REST API backed by a PostgreSQL database hosted on Supabase. Users authenticate with JWT tokens and optionally enable a vault that adds an extra encryption layer over sensitive data.

**Local Vault Mode**: All data lives entirely in an AES-256-GCM encrypted `.enc` file stored on the user's machine. The browser decrypts and re-encrypts the file locally using the WebCrypto API. No server communication is required in this mode. The pages and API hooks are completely mode-agnostic — the same UI code runs in both modes because a data-context abstraction layer switches implementations under the hood.

---

## 2. Java & Spring Boot Fundamentals

### Spring Boot Auto-Configuration
Spring Boot uses `@SpringBootApplication` which combines `@Configuration`, `@EnableAutoConfiguration`, and `@ComponentScan`. Auto-configuration reads the classpath and wires beans automatically — if `spring-boot-starter-web` is on the classpath, a Tomcat server is configured; if `spring-boot-starter-data-jpa` is present, a datasource and EntityManager are set up.

### Component Stereotypes
- `@RestController` — combines `@Controller` + `@ResponseBody`; return values are serialised to JSON automatically
- `@Service` — marks business logic classes; Spring manages them as singleton beans
- `@Repository` — marks data access classes; Spring wraps them with exception translation
- `@Configuration` — marks a class as a source of bean definitions

### Dependency Injection
Spring injects dependencies through constructor injection (preferred over field injection because it makes dependencies explicit and enables unit testing without a Spring context). Lombok `@RequiredArgsConstructor` generates the constructor automatically so there is no boilerplate.

### `application.properties` Property Binding
Properties can reference environment variables with defaults:
```properties
server.port=${PORT:8080}
```
If `PORT` is set (Railway injects it at runtime), that value is used. If not, `8080` is the fallback. This pattern works for any property and avoids hardcoding environment-specific values.

### `dotenv-java`
The `dotenv-java` library loads a `.env` file and injects values into system properties before Spring starts. This is wired in `Finora.java` (the main class) before `SpringApplication.run()` is called. In production (Railway), the `.env` file does not exist — environment variables are set directly by the platform.

### Lombok
Lombok annotations reduce boilerplate:
- `@Data` — generates getters, setters, `equals`, `hashCode`, `toString`
- `@Builder` — generates the Builder pattern
- `@RequiredArgsConstructor` — generates a constructor for all `final` fields
- `@NoArgsConstructor` / `@AllArgsConstructor` — specific constructors
- The annotation processor must be declared explicitly in `maven-compiler-plugin`'s `annotationProcessorPaths`

---

## 3. Spring Data JPA & Hibernate

### What JPA Is
JPA (Jakarta Persistence API) is a specification for mapping Java objects to relational database tables. Hibernate is the most common implementation. Spring Data JPA wraps Hibernate and adds the repository abstraction.

### Entity Mapping
```java
@Entity
@Table(name = "expenses")
public class Expense {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;
}
```
Key points:
- `GenerationType.IDENTITY` delegates ID generation to the database (PostgreSQL `BIGSERIAL`)
- `FetchType.LAZY` means the associated `User` is only loaded when explicitly accessed — this avoids N+1 queries by default
- Column lengths matter: `email VARCHAR(500)` is larger than usual because the value is AES-encrypted before storage

### Spring Data Repositories
Extending `JpaRepository<Entity, IdType>` gives free CRUD operations. Custom queries can be written in three ways:

1. **Derived method names**: `findByUserIdAndDateBetween(Long userId, LocalDate start, LocalDate end)` — Spring parses the method name and builds the JPQL query
2. **`@Query` annotation**: Explicit JPQL for complex queries with aggregates, joins, or subqueries
3. **Native queries**: `@Query(nativeQuery = true)` for PostgreSQL-specific SQL

### `ddl-auto=none`
In production, `spring.jpa.hibernate.ddl-auto=none` is critical. It tells Hibernate not to modify the schema. Flyway manages all schema changes. Setting this to `update` or `create-drop` in production is dangerous.

### JPA AttributeConverter
`AttributeConverter<EntityType, DatabaseType>` intercepts JPA reads and writes to transform values. Finora uses this for transparent encryption: the application works with plain strings, but the database always stores encrypted bytes. Two converters exist:
- `EncryptedStringConverter` — probabilistic (random IV each write), used for names and descriptions
- `DeterministicEncryptedStringConverter` — deterministic (HMAC-derived IV), used for email so equality queries (`findByEmail`) still work

---

## 4. Database Design & PostgreSQL

### Naming Conventions
All table and column names use `snake_case` (PostgreSQL convention). Java field names use `camelCase`. JPA bridges the two with `@Column(name = "password_hash")`.

### Data Types
- `BIGSERIAL` — auto-incrementing 64-bit integer (PostgreSQL's integer primary key type)
- `NUMERIC(19,2)` — exact decimal for monetary values; never use `FLOAT` or `DOUBLE` for money due to floating-point precision errors
- `NUMERIC(19,6)` — for prices and quantities that need more decimal places
- `NUMERIC(24,8)` — for SIP unit counts which can be very small fractions
- `TEXT` — unlimited-length strings; used when the stored value may be encrypted and thus longer than the original
- `TIMESTAMPTZ` — timestamp with time zone; stores UTC, displays in any timezone

### Foreign Keys and Cascade
```sql
user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE
```
`ON DELETE CASCADE` means deleting a user automatically deletes all their expenses, investments etc. This is simpler and more reliable than handling deletions in application code.

### Unique Partial Indexes
```sql
CREATE UNIQUE INDEX idx_investments_user_isin
    ON investments(user_id, isin)
    WHERE isin IS NOT NULL;
```
A partial index only applies the uniqueness constraint when `isin IS NOT NULL`. This allows multiple rows with `isin = NULL` (investments that have no ISIN), while still preventing duplicate ISIN imports per user.

### Append-Only Tables
The `ledger_events` table is designed to be append-only. A PostgreSQL trigger enforces this:
```sql
CREATE OR REPLACE FUNCTION prevent_ledger_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ledger events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_ledger_update
BEFORE UPDATE OR DELETE ON ledger_events
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_update();
```
No application code can circumvent this — the database itself rejects any attempt to modify or delete a ledger row.

### UUID vs BIGSERIAL
The `ledger_events` table uses `UUID` as its primary key (generated in Java with `UUID.randomUUID()`). UUIDs are appropriate here because ledger events may eventually be replicated or merged across systems, and UUID conflicts are astronomically unlikely. Regular domain tables (expenses, investments, loans) use `BIGSERIAL` because it is simpler, more efficient for indexing, and sequential ordering is useful.

---

## 5. Flyway — Database Migrations

Flyway manages the database schema through versioned SQL scripts. Scripts live in `src/main/resources/db/migration/` and follow the naming pattern `V{version}__{description}.sql` (two underscores).

### How Flyway Works
On application startup, Flyway connects to the database that checks a `flyway_schema_history` table. It compares applied migrations against the scripts in the classpath and runs any new ones in order. If a script fails, the migration is rolled back (partially — Flyway does not wrap DDL in transactions on all databases).

### Key Configuration
```properties
spring.flyway.baseline-on-migrate=true
spring.flyway.baseline-version=0
```
`baseline-on-migrate=true` is important when Flyway is introduced to an existing database. It marks the current state as the baseline (version 0) so Flyway does not try to run V1 on a database that already has those tables.

### Why Not `ddl-auto=update`
Hibernate's `ddl-auto=update` is tempting for development but dangerous in production — it cannot rename columns, drop columns, or handle complex migrations. Flyway gives full control and a traceable history of every schema change.

### Test Configuration
Tests use H2 (in-memory database). A separate Flyway script location or `spring.flyway.enabled=false` can be set for the test profile to avoid running PostgreSQL-specific SQL against H2.

---

## 6. REST API Design

### URL Structure
```
GET    /api/expenses          → list (paginated)
POST   /api/expenses          → create
GET    /api/expenses/{id}     → get one
PUT    /api/expenses/{id}     → full update
DELETE /api/expenses/{id}     → delete
DELETE /api/expenses/bulk     → bulk delete
POST   /api/expenses/import/preview   → two-step import step 1
POST   /api/expenses/import/confirm   → two-step import step 2
```
Resources are plural nouns. Actions that don't fit CRUD are expressed as sub-resources or action endpoints (`/refresh-prices`, `/pay`, `/sell-units`).

### `ApiResponse<T>` Wrapper
Every endpoint returns a consistent envelope:
```json
{
  "success": true,
  "message": "Expense created successfully",
  "data": { ... },
  "timestamp": "2024-01-15T10:30:00Z",
  "errorCode": null
}
```
This allows the frontend to always expect the same structure regardless of endpoint, and error handling is centralised in one Axios response interceptor.

### `@ControllerAdvice` — Global Exception Handling
`GlobalExceptionHandler` catches exceptions thrown anywhere in the application and converts them to appropriate HTTP responses:
- `ResourceNotFoundException` → 404
- `ValidationException` → 400
- `BusinessLogicException` → 422
- `MethodArgumentNotValidException` (Bean Validation) → 400 with field errors
- Any other `Exception` → 500

Without this, Spring would return a default error page or a partially-formed response.

### Bean Validation
DTOs are annotated with JSR-380 annotations (`@NotNull`, `@NotBlank`, `@Size`, `@Positive`, `@Email`). Spring validates them automatically when the controller parameter is `@Valid`:
```java
public ResponseEntity<?> createExpense(@Valid @RequestBody ExpenseRequestDTO dto) { ... }
```
Validation errors throw `MethodArgumentNotValidException`, caught by the global handler.

### Pagination
`Pageable` is accepted as a controller parameter and passed to repository methods. Spring resolves `?page=0&size=20&sort=date,desc` query parameters automatically. The response includes `Page<T>` which contains `content`, `totalElements`, `totalPages`, and `number`.

---

## 7. Security — JWT Authentication

### What JWT Is
A JSON Web Token is a compact, URL-safe token consisting of three Base64-encoded parts separated by dots: `header.payload.signature`. The header declares the algorithm (HS256). The payload contains claims (`sub` for subject, `exp` for expiry). The signature is computed over `header.payload` using a secret key, allowing the server to verify authenticity without a database lookup.

### Why JWT Over Sessions
Sessions require server-side state (a session store) and become complex in distributed deployments. JWTs are stateless — any server instance can verify a token using only the secret key. This is well-suited for Railway deployments where the number of instances can scale.

### Token Generation (JJWT 0.11.5)
```java
Jwts.builder()
    .setSubject(userId.toString())
    .setIssuedAt(new Date())
    .setExpiration(new Date(System.currentTimeMillis() + 7 * 24 * 60 * 60 * 1000L))
    .signWith(getSigningKey(), SignatureAlgorithm.HS256)
    .compact();
```
The subject is the `userId` (not the username), which avoids issues if a username changes. Expiry is 7 days.

### The JWT Secret
The secret is a 512-bit (64-byte) Base64-encoded random value stored in the `JWT_SECRET` environment variable. It is decoded to bytes and wrapped in an HMAC-SHA key object. The secret must never be committed to version control.

### `JwtAuthFilter`
Extends `OncePerRequestFilter` (guaranteed to run once per request, even in forward chains). It:
1. Reads the `Authorization` header
2. Extracts the Bearer token
3. Validates signature and expiry
4. Loads the user from the database (or from the token subject)
5. Sets `UsernamePasswordAuthenticationToken` in `SecurityContextHolder`

Once the authentication is in `SecurityContextHolder`, any downstream Spring component can call `SecurityContextHolder.getContext().getAuthentication()` to get the current user.

### Password Hashing
BCrypt is used for password hashing. BCrypt embeds the salt in the hash output, so no separate salt column is needed. The work factor is configurable and should be increased over time as hardware gets faster. BCrypt intentionally hashes slowly to make brute-force attacks expensive.

---

## 8. Security — Field-Level Encryption & Vault

### Why Field-Level Encryption
Even if the database is compromised (e.g., a Supabase breach), the attacker would see only encrypted ciphertext. They cannot read sensitive names, descriptions, or email addresses.

### AES-256-GCM
AES-GCM (Galois/Counter Mode) is an authenticated encryption algorithm. It provides:
- **Confidentiality**: The plaintext is encrypted
- **Integrity + Authenticity**: The authentication tag detects any tampering with the ciphertext
- 256-bit key means $2^{256}$ possible keys — computationally infeasible to brute force

### Probabilistic vs Deterministic Encryption
**Probabilistic (random IV)**: Each encryption uses a new random 12-byte IV. The same plaintext encrypts to a different ciphertext every time. This is more secure because it conceals whether two rows have the same value. Used on `Investment.name`, `Expense.description`, `Loan.name`, `Sip.name`.

**Deterministic (HMAC-derived IV)**: The IV is derived from the plaintext via HMAC-SHA256. The same plaintext always produces the same ciphertext, enabling equality lookups (`WHERE email = ?`). This slightly leaks that two rows have the same value, but is necessary for `findByEmail` queries. Used only on `User.email`.

### Stored Format
Both converters store values as `v1:<base64(salt + IV + ciphertext)>`. The `v1:` prefix allows future algorithm changes — the decryption logic checks the version prefix and selects the appropriate algorithm.

### PBKDF2 Key Derivation
PBKDF2 (Password-Based Key Derivation Function 2) derives a cryptographic key from a human-memorable passphrase:
- **Algorithm**: PBKDF2WithHmacSHA256
- **Iterations**: 310,000 (NIST recommendation for SHA-256 in 2024)
- **Salt**: 16 random bytes (unique per encryption operation)
- **Output**: 256-bit key

Higher iteration counts mean a brute-force attacker must do 310,000 hash computations per guess. On a modern GPU, this reduces the guessing rate to manageable levels.

### The Vault System
The vault adds a second encryption layer for users who want maximum protection. When a user enables the vault:
1. The server generates a 16-byte random salt and stores it in `users.vault_salt`
2. The client derives a 256-bit key from the user's chosen passphrase + the salt using PBKDF2 (310,000 iterations) via the WebCrypto API — this computation happens in the browser, the raw passphrase never leaves the client
3. The derived key is stored in `sessionStorage` (not `localStorage`) so it clears when the tab closes
4. Every request sends the derived key in the `X-Vault-Key` header

`VaultKeyFilter` reads this header and stores the key in a `ThreadLocal` (`VaultKeyContext`). `FieldEncryptionService` checks this ThreadLocal when encrypting/decrypting — if a vault key is present, it applies a second AES-GCM layer over the server-side encrypted value. The result is stored as `v2:<...>`.

This means even the server operator cannot read the data without the user's passphrase, because the innermost layer was encrypted and decrypted entirely client-side.

### ThreadLocal for Request-Scoped State
`ThreadLocal<T>` stores a value per thread. In a synchronous web server where each HTTP request runs on its own thread, `ThreadLocal` is a clean way to pass request-scoped context (like the vault key) without threading it through every method parameter. It **must** be cleared in a `finally` block to prevent leaking to the next request that reuses the thread from the pool.

---

## 9. Security — Ledger Integrity & Tamper Detection

### Motivation
If someone (including a database administrator) modifies or deletes financial records, it should be detectable. A cryptographic hash chain makes tampering evident.

### Hash Chain Construction
Each `LedgerEvent` contains:
- `prevHash` — the hash of the most recent previous event for the same user
- `hash` — SHA-256 of the canonical string: `entityType|entityId|action|encryptedBefore|encryptedAfter|timestamp|prevHash|userId|version`

The first event for a user has `prevHash = "GENESIS"`.

Verification replays every event in sequence, recomputes each hash, checks `hash == computed` and `prevHash == previous hash`. Any modification anywhere in the chain breaks the hash link.

### Canonical JSON
To hash an object reliably, its JSON representation must be deterministic. A regular `ObjectMapper` may output fields in different orders depending on how the object was constructed. The canonical form sorts all keys alphabetically and formats dates as ISO-8601 strings. `HashingUtils.toCanonicalJson()` handles this.

### Database-Level Enforcement
A PostgreSQL trigger (`BEFORE UPDATE OR DELETE`) raises an exception unconditionally. This means even a superuser executing raw SQL would need to first drop the trigger to tamper with the ledger — and that action itself would be logged in the database audit trail.

### Ledger API
- `GET /api/ledger/verify` — replays the entire hash chain and reports integrity status, total events, and the index of the first broken link if any
- `GET /api/ledger/entity/{type}/{id}` — returns the full event timeline for a specific entity (e.g., a specific investment)

---

## 10. Spring Security Configuration

### Disabling CSRF
CSRF protection is for browser-based session authentication where cookies carry credentials automatically. With JWT authentication, the client explicitly adds the `Authorization` header to every request. Cookies are not involved, so CSRF is not a threat. For REST APIs with JWT, CSRF should be disabled.

### Stateless Session Policy
```java
.sessionManagement(sess -> sess.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
```
This tells Spring Security not to create or use HTTP sessions. Each request is authenticated independently via the JWT.

### Filter Chain Order
Spring Security is itself a filter chain. Custom filters are inserted at specific positions:
```java
.addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
.addFilterBefore(vaultKeyFilter, JwtAuthFilter.class)
```
`VaultKeyFilter` runs first (reads the `X-Vault-Key` header into `VaultKeyContext`), then `JwtAuthFilter` authenticates the user, then the regular Spring Security filters run.

### CORS Configuration
CORS (Cross-Origin Resource Sharing) is a browser security feature that blocks JavaScript from making requests to a different origin than the page's origin. The backend must explicitly allow the frontend's origin. Allowed origins are read from `cors.allowed.origins` (a comma-separated environment variable), so production and local origins can both be allowed without code changes.

---

## 11. Rate Limiting

### `LoginRateLimiter`
A simple in-memory rate limiter using `ConcurrentHashMap<String, List<Long>>` where the key is the client IP and the value is a list of login attempt timestamps.

On each login attempt:
1. Remove timestamps older than 60 seconds (the sliding window)
2. If the list has 5 or more entries, reject with 429
3. Otherwise, add the current timestamp and allow

A `@Scheduled` task runs every 5 minutes to clean up empty entries from the map to prevent memory growth.

### Why Not a Library
Simple rate limiting for a single endpoint does not justify adding a dependency. This implementation is correct, easy to understand, and sufficient for the use case. A distributed system (multiple server instances) would need a shared store like Redis, but Railway deploys a single instance.

### Getting the Client IP
In a proxied deployment (Railway → Nginx → Spring Boot), the client's real IP is in the `X-Forwarded-For` header. The `HttpServletRequest.getRemoteAddr()` would return the proxy's IP. The rate limiter reads `X-Forwarded-For` first, falling back to `getRemoteAddr()`.

---

## 12. External APIs — Price Providers

### Strategy Pattern for Price Fetching
Defining a `PriceProviderStrategy` interface with `fetchPrice(symbol, type)`, `isAvailable()`, and `getProviderName()` means new price sources can be added without modifying existing code. The orchestrator (`PriceProviderService`) simply iterates the registered providers in order.

### Yahoo Finance
Yahoo Finance provides free, unofficial endpoints. The API returns JSON with current price, currency, and other market data. It is the primary price provider but can be rate-limited or unavailable, which is why a fallback exists.

### AlphaVantage
AlphaVantage provides an official (but rate-limited) API with an API key. It is the fallback. The free tier allows 25 requests per day, so it is used sparingly.

### AMFI NAV Service
For Indian mutual funds, AMFI (Association of Mutual Funds in India) publishes a daily NAV (Net Asset Value) file at a public URL. The `AmfiNavService` fetches this file (a large CSV with scheme codes and NAVs), parses it into a map, and allows lookup by scheme code or ISIN. It also supports search by fund name for the mutual fund search feature.

---

## 13. File Parsing — PDFBox & Apache POI

### Two-Step Import Flow
Statement imports follow a preview-then-confirm pattern:
1. **Preview**: Upload the file, parse it, return a list of records for the user to review. Nothing is saved yet.
2. **Confirm**: The user reviews the parsed records, deselects any they do not want, and submits. The selected records are saved with upsert semantics (update if ISIN already exists, insert if not).

This prevents accidental duplicate imports and gives the user control over what gets saved.

### PDFBox — Parsing PDF Statements
Apache PDFBox extracts text from PDFs. CAS (Consolidated Account Statement) and CAMS PDFs contain mutual fund holdings in a structured text format. The parser extracts text page by page and uses regex patterns to identify fund names, ISINs, units, and NAVs.

PDF parsing is inherently fragile because PDFs do not have a semantic structure — they are layout instructions for a printer. Different PDF generators produce different text extraction results even for visually identical documents.

### Apache POI — Parsing Excel/CSV
POI reads `.xlsx` files using the XSSF (XML Spreadsheet Format) API. The `HoldingsExcelParser` auto-detects the column layout by scanning the header row for known column names (like "ISIN", "Symbol", "Quantity", "Average Price"). This makes it work with broker-specific export formats without manual configuration.

### Why These Are Excluded From Coverage
PDFBox and POI parsers are excluded from JaCoCo coverage requirements because:
- They depend on specific file formats that are impractical to generate in unit tests
- The parsing logic is inherently integration-tested (real files produce correct records)
- False coverage numbers would result if these were included

---

## 14. Scheduled Tasks & Virtual Threads

### `@Scheduled` Tasks
Spring's `@EnableScheduling` + `@Scheduled` annotation runs methods on a fixed schedule. Cron expressions control timing:
- `0 0 9 1 * *` — at 09:00 on the 1st of every month (SIP processing)
- `0 0 0 * * *` — at midnight every day (loan balance recalculation)

### SIP Monthly Processing
On the 1st of the month, `FinanceDataUpdateScheduler` loads all active SIPs, fetches the latest NAV from AMFI, and creates a new investment unit entry. This simulates the monthly SIP investment without requiring the user to manually intervene.

### Virtual Threads (JDK 21)
For investment price refresh (which may make dozens of HTTP calls), Virtual Threads are used:
```java
Thread.ofVirtual().start(() -> updatePrice(investment));
```
Virtual Threads are lightweight threads managed by the JVM, not the OS. Thousands of them can be created without the overhead of OS threads. They are perfect for I/O-bound work (HTTP calls) because blocking a Virtual Thread merely suspends the carrier OS thread's continuation, allowing other Virtual Threads to proceed.

### Difference from Platform Threads
A Platform Thread maps 1:1 to an OS thread. Creating 1000 Platform Threads for 1000 HTTP calls would exhaust thread pool limits and consume significant memory. Virtual Threads defer to JVM scheduling, making high-concurrency I/O trivial.

---

## 15. Maven — Build, Testing & Coverage

### `pom.xml` Structure
The `spring-boot-starter-parent` provides a BOM (Bill of Materials) that declares compatible versions for all Spring-related dependencies. This is why most dependencies do not need explicit version numbers — Spring's BOM manages compatibility.

### Surefire Plugin
`maven-surefire-plugin` runs unit tests during the `test` Maven lifecycle phase. Configuring it to activate the `test` Spring profile (`-Dspring.profiles.active=test`) allows test-specific `application-test.properties` to override the main configuration (e.g., use H2 instead of PostgreSQL).

The JVM argument `--add-opens java.base/java.lang=ALL-UNNAMED` is needed for JDK 21 because some testing frameworks (like Mockito) use reflection to access JDK internals that are now module-restricted.

### JaCoCo Coverage
JaCoCo instruments bytecode at runtime to track which lines and branches are executed during tests. The `check` goal fails the build if coverage drops below:
- 85% instruction coverage (line-level)
- 75% branch coverage (if/else, switch)

Exclusions in `pom.xml` prevent unfairly penalising code that cannot be meaningfully unit-tested (file parsers, main class, external API clients).

### Running Tests with H2
H2 is an in-memory database written in Java. It requires no installation, starts in milliseconds, and is destroyed at the end of the test run. For Spring tests, adding `spring.datasource.url=jdbc:h2:mem:testdb` and `spring.jpa.hibernate.ddl-auto=create-drop` (or using Flyway with H2-compatible scripts) makes tests run entirely in memory.

---

## 16. Checkstyle — Code Quality

Checkstyle statically analyses Java source code and reports violations of configured rules. Rules in `checkstyle.xml`:

**Naming conventions** (errors, build-breaking):
- Classes: `UpperCamelCase`
- Methods and variables: `lowerCamelCase`
- Constants: `UPPER_SNAKE_CASE` (with an exception allowing `log`/`logger`)
- Packages: `all.lowercase.dot.separated`

**Import hygiene**: Redundant imports (same class imported twice) and star imports (`import java.util.*`) are flagged. Explicit imports document exactly which classes are used.

**Code clarity**: `StringLiteralEquality` catches `str == "literal"` (reference equality instead of `.equals()`). `SimplifyBooleanReturn` catches `if (x) return true; else return false;` (should be `return x;`).

Running Checkstyle in CI (via `make lint-api`) catches style issues before code review.

---

## 17. React & TypeScript Fundamentals

### Why TypeScript
TypeScript adds static typing to JavaScript. At compile time, it catches type mismatches that would otherwise be runtime errors. For a financial application where passing the wrong type (e.g., a string where a number is expected) could corrupt data, TypeScript's compile-time safety is essential.

### `tsconfig.json`
Key compiler options for this project:
- `"strict": true` — enables all strict checks (no implicit `any`, strict null checks, etc.)
- `"moduleResolution": "bundler"` — Vite resolves modules; TypeScript should match
- `"jsx": "react-jsx"` — use the new JSX transform (no `import React` needed in every file)

### Component Structure
Functional components with hooks replaced class components. A component is a function that returns JSX. State is managed with `useState`. Side effects (data fetching, subscriptions) are managed with `useEffect`.

### `useEffect` Dependency Array
The second argument to `useEffect` controls when the effect re-runs:
- `[]` — run once after initial render (on mount)
- `[value]` — re-run whenever `value` changes
- No second argument — re-run after every render (usually incorrect)

### TypeScript `types/` Directory
All domain types (`Expense`, `Investment`, `Loan`, `Sip`, `User`) are defined centrally. This single source of truth prevents inconsistencies between API response handling and UI rendering. When the backend adds a field, updating the TypeScript type immediately surfaces all places that need to handle it.

---

## 18. React Context API — State Management

### When to Use Context
Context is appropriate for state that is needed by many components at different nesting levels: authentication state, theme, vault state. It avoids prop-drilling (passing the same props through many intermediate components).

### Context + Provider Pattern
```typescript
const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    // ... state logic
    return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
};
```
The `useAuth()` hook enforces usage within the provider, throwing an error early if someone forgets to wrap their component tree.

### Provider Hierarchy
The order of providers in `App.tsx` matters:
```tsx
<ThemeProvider>
    <AuthProvider>
        <LocalVaultProvider>
            <BrowserRouter>...</BrowserRouter>
        </LocalVaultProvider>
    </AuthProvider>
</ThemeProvider>
```
Inner providers can consume outer providers. `LocalVaultProvider` could theoretically use auth state if needed.

---

## 19. Dual-Mode Architecture (Cloud vs Local Vault)

### The Problem
The UI needs to work identically whether data comes from a REST API or from an in-memory JavaScript object. The same `ExpensesPage.tsx` must work in both modes.

### The Solution: Hook Abstraction
`data-context.tsx` exports hooks that return the right implementation based on mode:
```typescript
export const useExpenseApi = () => {
    const vault = useLocalVault();
    if (vault.isLocalMode) {
        return localExpenseImplementation(vault);  // pure JS, no network
    }
    return expenseApi;  // real axios client
};
```
Every implementation returns the same function signatures. The page component cannot tell which implementation it is using.

### Local Implementation
The local implementations compute all derived values in JavaScript:
- Expense summaries: group by category, sum amounts
- Investment P&L: `(currentPrice - purchasePrice) * quantity`
- Loan remaining months: compute from startDate + tenureMonths

These calculations mirror the server-side computations. Keeping them in sync is a maintenance responsibility — when the server adds a new calculation, the local implementation must be updated too.

### Draft Auto-Save (IndexedDB)
The local vault context saves a draft to IndexedDB on every mutation. If the browser tab crashes before the user saves the file, the draft allows recovery. On `openVaultFromFile`, the context checks for a draft and offers to restore it.

---

## 20. WebCrypto API — Browser-Side Encryption

### Why WebCrypto
`window.crypto.subtle` is a browser-native cryptography API that runs in a secure context (HTTPS). It uses optimised native code and never exposes raw keys to JavaScript — keys are represented as opaque `CryptoKey` objects.

### PBKDF2 Key Derivation (Browser)
```typescript
const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
);

const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
);
```

### AES-GCM Encryption (Browser)
```typescript
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(data))
);
```
The output is an `ArrayBuffer` containing `[salt(16) | IV(12) | ciphertext]`. This byte layout exactly matches Java's `CryptoService`, enabling a backup exported from the backend to be decryptable in the browser (and vice versa).

### sessionStorage vs localStorage
The derived vault key is stored in `sessionStorage`. Unlike `localStorage`:
- `sessionStorage` is cleared when the tab closes
- Each tab has its own isolated `sessionStorage` scope
- This means the vault auto-locks when the browser tab is closed — acceptable for security-sensitive data

---

## 21. IndexedDB — Client-Side Persistence

### What IndexedDB Is
IndexedDB is a low-level browser key-value store for structured data. It supports transactions, indexes, and can store binary data (like `ArrayBuffer`). It is asynchronous (Promise-based in modern wrappers).

### Vault Draft Storage
```typescript
const db = await openDB("finora-local-vault", 1, {
    upgrade(db) { db.createObjectStore("draft"); }
});
await db.put("draft", encryptedData, "current");
```
Every time the vault data changes, the encrypted data is written to IndexedDB. On next open, if a draft exists, the user is prompted to restore it.

### Why Not `localStorage`
`localStorage` only stores strings and has a 5MB limit. A vault file with many transactions could exceed this. IndexedDB handles binary data and has a much higher storage limit (typically gigabytes, limited by available disk space).

---

## 22. File System Access API

### What It Is
The File System Access API (`window.showSaveFilePicker`, `window.showOpenFilePicker`) lets the browser request direct access to a specific file on the user's disk. The user picks the file once, and the app holds a `FileSystemFileHandle` that allows reading and writing without prompting the user again (within the same session).

### Vault File Saving
```typescript
const handle = await window.showSaveFilePicker({
    suggestedName: "finora-vault.enc",
    types: [{ accept: { "application/octet-stream": [".enc"] } }]
});
const writable = await handle.createWritable();
await writable.write(encryptedBuffer);
await writable.close();
```

### Fallback (Download)
Chromium supports the File System Access API. Firefox and Safari have limited support. The fallback creates a temporary `<a>` element with a `Blob` URL and clicks it programmatically:
```typescript
const blob = new Blob([encryptedBuffer], { type: "application/octet-stream" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "finora-vault.enc";
a.click();
URL.revokeObjectURL(url);
```

---

## 23. Axios — HTTP Client & Interceptors

### Axios Instance Configuration
A single Axios instance is created with `baseURL: "/api"` and a default timeout. All API files import from this instance, ensuring consistent configuration.

### Request Interceptor — Adding Auth Headers
```typescript
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem("auth_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    const vaultKey = sessionStorage.getItem("vault_key");
    if (vaultKey) config.headers["X-Vault-Key"] = vaultKey;
    return config;
});
```
Every outgoing request automatically carries the auth token and vault key. The API functions themselves do not need to think about headers.

### Response Interceptor — Centralised Error Handling
```typescript
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem("auth_token");
            window.location.href = "/welcome";
        }
        return Promise.reject(error);
    }
);
```
A 401 means the token expired or is invalid. The interceptor clears local storage and redirects to the landing page. Individual API calls do not handle 401 separately.

### Binary Response (Backup Export)
For the backup export, the response is binary (an encrypted file, not JSON). Using `fetch()` directly with `responseType: "blob"` is simpler for this case:
```typescript
const response = await fetch("/api/backup/export", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
});
const blob = await response.blob();
```

---

## 24. Vite — Frontend Build Tool

### Why Vite Over Webpack
Vite uses native ES modules in development — the browser loads each file individually rather than waiting for a bundle. This makes the development server start nearly instantly regardless of project size. Production builds use Rollup (bundled into Vite) and produce optimised bundles with tree-shaking and code splitting.

### `optimizeDeps.exclude: ['lucide-react']`
This tells Vite not to pre-bundle `lucide-react` during `npm run dev`. Pre-bundling converts CJS packages to ESM. `lucide-react` is already ESM, and pre-bundling it unnecessarily can slow the initial dev server start.

### `VITE_API_BASE_URL`
Vite exposes environment variables prefixed with `VITE_` to client-side code via `import.meta.env.VITE_API_BASE_URL`. This is a security feature — without the prefix, environment variables would not be exposed, preventing accidental exposure of server-side secrets.

In the Docker Compose setup, `VITE_API_BASE_URL=/api` is passed as a build argument. At build time Vite bakes this value into the bundle. The Nginx reverse proxy then routes `/api/*` to the backend container.

---

## 25. Tailwind CSS

### Utility-First CSS
Tailwind provides single-purpose utility classes (`text-sm`, `p-4`, `flex`, `bg-primary-500`). Instead of writing custom CSS, classes are composed directly in JSX. There is no context-switching between JS and CSS files.

### `darkMode: 'class'`
When a `dark` class is added to the `<html>` element, all `dark:` prefixed utilities activate:
```tsx
<div className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white">
```
The `ThemeContext` toggles the `dark` class on `document.documentElement` based on user preference and system preference detection.

### Custom Colour Scale
The project extends Tailwind's default palette with a complete custom scale (`primary`, `success`, `error`, `warning`, `neutral`) with shades 50–950. This allows semantic colour naming (`text-success-600`, `bg-error-100`) that automatically adapts to dark mode via variants.

### `clsx` and `tailwind-merge`
`clsx` constructs conditional class strings (`clsx("base-class", isActive && "active-class")`). `tailwind-merge` merges Tailwind classes intelligently, resolving conflicts (`tailwind-merge("p-2 p-4")` → `"p-4"`). Together they handle dynamic class generation without accidental overrides.

---

## 26. Recharts — Data Visualisation

### Responsive Containers
Charts are wrapped in `<ResponsiveContainer width="100%" height={300}>`. This makes them fill their parent element. Without this, a chart would have a fixed pixel size that does not adapt to different screen widths.

### `PieChart` for Category Distribution
Expense categories are visualised as a pie chart. The data format is `[{ name: "Food", value: 12000 }, ...]`. The `COLORS` array cycles through the custom colour scale.

### `BarChart` for Monthly Trends
Monthly expense totals are visualised as a bar chart with X-axis labels (month names) and a Y-axis in INR. `<Tooltip formatter={(value) => formatCurrency(value)}>` formats tooltip values with the Indian number format.

---

## 27. Excel & PDF Export in the Browser

### `xlsx` Library (SheetJS)
```typescript
const ws = XLSX.utils.json_to_sheet(expenses);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Expenses");
XLSX.writeFile(wb, "expenses.xlsx");
```
`json_to_sheet` converts an array of objects directly to a worksheet. Column names come from object keys.

### `jspdf` + `jspdf-autotable`
```typescript
const doc = new jsPDF();
doc.autoTable({ head: [columns], body: rows });
doc.save("report.pdf");
```
`jspdf-autotable` is a plugin that adds the `autoTable` method to `jsPDF` instances, making it straightforward to generate structured PDF reports with headers, borders, and alternating row colours.

---

## 28. React Router v6

### `<Outlet>` for Nested Layouts
The `Layout` component (sidebar + header) renders `<Outlet>` where child route components appear. This means adding a new protected route only requires adding an `<Route>` in `App.tsx` — the layout is automatically applied.

### `ProtectedRoute` Component
A wrapper component that checks authentication state. If `isLoading` is true, it renders a spinner. If `user` is null, it redirects to `/welcome`. Otherwise it renders `<Outlet>`. This pattern centralises authentication guarding.

### Programmatic Navigation
`useNavigate()` returns a function for programmatic navigation:
```typescript
const navigate = useNavigate();
navigate("/login", { replace: true });  // replace history entry
```
`replace: true` prevents the user from navigating back to the page they were redirected from.

---

## 29. Docker & Docker Compose

### Multi-Stage Build (Backend)
```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
# ... build stage (large image with Maven + JDK)

FROM eclipse-temurin:21-jre-alpine
# ... runtime stage (small image with only JRE)
```
The build stage produces the fat JAR. The runtime stage copies only the JAR. The final image does not contain the Maven installation, source code, or test dependencies — significantly smaller and with a smaller attack surface.

### Multi-Stage Build (Frontend)
The frontend Dockerfile builds with Node.js (large), then copies the `dist/` directory into an Nginx image (small). Nginx serves static files with far better performance than Node.js.

### Docker Compose Networking
All services are connected via a custom `bridge` network (`finance-tracker-network`). Services communicate using service names as hostnames (e.g., the backend container reaches PostgreSQL at `postgres:5432`). This DNS resolution works automatically within a Docker Compose project.

### Non-Root User
```dockerfile
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring
```
Running the container as a non-root user limits the blast radius if the application is exploited. A process running as root in a container can potentially escape to the host; a non-root user cannot.

### Health Checks
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/actuator/health || exit 1
```
Docker uses health checks to determine if a container is ready. Docker Compose's `depends_on: condition: service_healthy` can wait for the backend to be healthy before starting the frontend.

### Persisted Volumes
```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```
Without a named volume, all database data would be lost when the container is removed. The named volume persists the data directory across container restarts and rebuilds.

---

## 30. Nginx — Reverse Proxy & SPA Serving

### SPA Fallback
```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```
For a React SPA, all routes are handled by JavaScript. When a user navigates directly to `/expenses`, Nginx needs to serve `index.html` (not return 404). `try_files` tries the exact path, then the path as a directory, then falls back to `index.html`.

### Reverse Proxy to Backend
```nginx
location /api/ {
    proxy_pass ${BACKEND_URL}/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```
`X-Forwarded-For` carries the original client IP through the proxy chain. The backend's `LoginRateLimiter` reads this header to get the real client IP.

### `proxy_ssl_server_name on`
When the backend URL is HTTPS (Railway deployment), TLS SNI (Server Name Indication) must be enabled for the proxy SSL handshake to work correctly. Without this, the handshake may fail with certificate errors.

### Static Asset Caching
```nginx
location ~* \.(js|css|png|jpg|svg|ico|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```
Vite generates filenames with content hashes (e.g., `main-AbCdEf12.js`). Since the hash changes when the content changes, these files can be cached indefinitely (`immutable`). The browser never re-downloads unchanged assets.

### Gzip Compression
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;
gzip_min_length 1000;
```
Gzip compresses text responses before sending them. JavaScript bundles typically compress 60–80% — a 500KB bundle becomes ~120KB over the wire. This significantly reduces page load time on slow connections.

### Environment Variable Substitution in Nginx Config
Nginx does not natively support environment variables in config files. The container uses `envsubst` on startup to replace `${PORT}` and `${BACKEND_URL}` placeholders with actual values before Nginx starts. The Dockerfile entrypoint runs:
```dockerfile
CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
```

---

## 31. Supabase — Managed PostgreSQL

### What Supabase Is
Supabase is an open-source Firebase alternative built on top of PostgreSQL. It provides a hosted PostgreSQL instance with a dashboard, authentication services, and a REST API layer. Finora uses only the PostgreSQL database — not Supabase's built-in auth or REST API (those are handled by the Spring Boot backend).

### Connection String
Supabase provides a connection string in two modes:
- **Direct connection**: `postgresql://user:pass@db.xxx.supabase.co:5432/postgres` — used for long-running connections. Requires `sslmode=require`.
- **Transaction pooler**: A PgBouncer pooler endpoint — better for serverless/short-lived connections. Used with `?pgbouncer=true`.

Finora uses direct connection because Spring Boot keeps a persistent HikariCP connection pool, not short-lived connections.

### `sslmode=require`
Supabase requires SSL for all connections. Adding `?sslmode=require` to the JDBC URL encrypts the connection between the application and Supabase. Without this, Supabase rejects the connection.

### Free Tier Limits
Supabase free tier limits connections to 25 concurrent active connections. This is why HikariCP is configured with `maximum-pool-size=5` — keeping the pool small ensures the application does not exhaust the connection limit even if multiple instances run.

### Supabase Dashboard
The Supabase dashboard provides a SQL editor, table viewer, and connection monitoring. It is useful for:
- Running migration scripts manually during development
- Verifying that Flyway applied migrations correctly
- Checking active connections and killing idle ones if the pool becomes stuck

---

## 32. Railway — Cloud Deployment

### What Railway Is
Railway is a Platform as a Service (PaaS) that deploys applications from Dockerfiles or auto-detected buildpacks. It handles container orchestration, networking, TLS certificates, and domain names. Each service gets a `*.railway.app` subdomain with automatic HTTPS.

### `railway.toml`
```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/actuator/health"
healthcheckTimeout = 90
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```
Railway uses the `healthcheckPath` to determine if the deployment succeeded. If the health endpoint does not return 200 within `healthcheckTimeout` seconds, Railway marks the deployment as failed and rolls back.

### `PORT` Environment Variable
Railway injects a `PORT` environment variable into every service container. The application must listen on this port, not a hardcoded one. `server.port=${PORT:8080}` in `application.properties` respects this.

### Environment Variables on Railway
Railway has a Variables panel per service where environment variables are set. They are injected into the container at runtime. Sensitive values (database passwords, JWT secrets) are set here, never in the Dockerfile or committed files.

### Service-to-Service Communication
On Railway, two separate services (frontend and backend) communicate via Railway's private network (using internal hostnames) or via their public URLs. Using the public URL adds TLS overhead and goes through Railway's edge, so the internal URL is preferred where available.

### Deployment on Push
Railway can be connected to a GitHub repository. Every push to the main branch triggers an automatic build and deployment. The new container is built, health-checked, and traffic is shifted to it only after the health check passes.

### `railway.toml` `restartPolicyType`
`"on_failure"` means Railway restarts the service if it crashes. With `maxRetries: 3`, it will attempt 3 restarts before giving up (and sending a notification). This handles transient crashes (e.g., a database connection failure on startup) without manual intervention.

---

## 33. Environment Variables & Secrets Management

### Twelve-Factor App Principle
Configuration that varies between environments (development, staging, production) should be stored in environment variables, not in code or config files. This principle comes from the Twelve-Factor App methodology.

### `.env` File (Local Development)
The `.env` file at `Finora-API/.env` contains local development credentials. It is loaded by `dotenv-java` at startup. This file is in `.gitignore` to prevent committing credentials.

### `.env.example`
`.env.example` is committed to the repository and contains all required variable names with placeholder values. New team members copy it to `.env` and fill in real values. This documents what is needed without exposing secrets.

### What Never Goes in Version Control
- Database passwords
- JWT secrets
- API keys (AlphaVantage, etc.)
- Encryption keys

### Why Secrets in Environment Variables
If a secret is committed to a Git repository (even briefly before deletion), it is permanently in the Git history and should be considered compromised. Environment variables are injected at runtime and are not stored in the repository.

---

## 34. HikariCP — Connection Pooling

### What Connection Pooling Is
Opening a new database connection is expensive — it requires a TCP handshake, PostgreSQL authentication, and session setup. A connection pool keeps a set of pre-opened connections available for reuse. HikariCP is Spring Boot's default connection pool and is known for its performance.

### Key Configuration Parameters
```properties
spring.datasource.hikari.maximum-pool-size=5
spring.datasource.hikari.minimum-idle=2
spring.datasource.hikari.idle-timeout=600000       # 10 minutes
spring.datasource.hikari.max-lifetime=1800000       # 30 minutes
```
- `maximum-pool-size`: The maximum number of connections in the pool. Set to 5 to respect Supabase's 25-connection free tier limit.
- `minimum-idle`: HikariCP maintains at least this many connections even when idle, avoiding latency spikes on low-traffic periods.
- `idle-timeout`: A connection idle for 10 minutes is closed and removed from the pool.
- `max-lifetime`: Each connection is closed and recreated after 30 minutes regardless. This handles cases where the database server closes idle connections from its side.

### Why Small Pool Sizes Are Better
A common mistake is setting a large pool size believing more connections = better performance. In reality, the bottleneck is usually the database CPU or disk I/O, not connection overhead. Fewer connections with less contention often performs better than many connections all competing for database resources.

---

## 35. CompletableFuture — Parallel Async Work

### The Finance Summary Endpoint
`GET /api/finance-summary` returns expense summary, investment summary, loan summary, SIP summary, net worth, and monthly averages in a single response. Each piece requires database queries. Executing them sequentially would add up latency.

### `CompletableFuture.supplyAsync()`
```java
CompletableFuture<ExpenseSummaryDTO> expenseFuture =
    CompletableFuture.supplyAsync(() -> expenseService.getSummary(userId), executor);

CompletableFuture<InvestmentSummaryDTO> investmentFuture =
    CompletableFuture.supplyAsync(() -> investmentService.getSummary(userId), executor);

CompletableFuture.allOf(expenseFuture, investmentFuture /*, ...*/).join();
```
All five futures run in parallel. `allOf(...).join()` waits for all of them to complete. Total time is bounded by the slowest query, not the sum of all query times.

### SecurityContext Propagation
Spring's `SecurityContextHolder` stores authentication in a `ThreadLocal`. When `supplyAsync` runs on a different thread, the `ThreadLocal` is empty — the service would not know the authenticated user.

The solution: capture the `SecurityContext` from the calling thread and set it in each async task:
```java
SecurityContext context = SecurityContextHolder.getContext();
CompletableFuture.supplyAsync(() -> {
    SecurityContextHolder.setContext(context);
    try {
        return expenseService.getSummary(userId);
    } finally {
        SecurityContextHolder.clearContext();
    }
}, executor);
```

---

## 36. Design Patterns Used

### Strategy Pattern (Price Providers)
`PriceProviderStrategy` interface with `YahooFinancePriceProvider` and `AlphaVantagePriceProvider` implementations. `PriceProviderService` iterates them without knowing specifics. Adding a new price source requires no changes to existing code.

### Factory Pattern (Investment Creation)
`InvestmentFactory.createFromRequest(dto)` centralises the creation logic. If the business rules for creating an investment change (e.g., requiring a minimum quantity validation), only the factory needs updating.

### Facade Pattern (Finance Summary)
`FinanceSummaryFacade` presents a simple `getComprehensiveSummary()` method that internally coordinates five service calls in parallel. The controller is unaware of the parallel execution complexity.

### Repository Pattern
All database access goes through Spring Data repository interfaces. Service classes never use JDBC or EntityManager directly. This makes it trivial to swap the underlying data source (e.g., replace PostgreSQL with a different database) without service layer changes.

### Observer / Event Pattern (Scheduled Scheduler)
`FinanceDataUpdateScheduler` acts as a periodic event publisher that triggers processing on scheduled events (month start, midnight). It is decoupled from the services it calls.

### Dual-Mode / Adapter Pattern (Data Context)
`useExpenseApi()` returns either the real REST client or a local in-memory adapter. The consuming pages only know the interface, not the implementation — this is the Adapter pattern applied at the React hook level.

---

## 37. Testing Strategy

### Unit Tests with H2
Service and controller tests use `@SpringBootTest` with the `test` profile activated. The test profile configures:
- H2 in-memory database
- Flyway disabled (or H2-compatible migrations)
- A fixed JWT secret for deterministic token generation

### Mocking with Mockito
Service tests mock repository dependencies with `@MockBean`. Controller tests mock service dependencies. This isolates the unit under test and avoids database calls:
```java
@MockBean
private ExpenseRepository expenseRepository;

when(expenseRepository.findByUserId(anyLong())).thenReturn(List.of(mockExpense));
```

### Coverage Exclusions
JaCoCo exclusions are specified in `pom.xml`:
- `Finora.class` — the main class cannot be meaningfully tested
- Parser classes — depend on real files; tested through integration
- Price provider classes — depend on external APIs; tested with mocked HTTP or integration tests

### Test Naming Convention
Test class names follow `{ClassUnderTest}Test` (e.g., `ExpenseServiceTest`). Test method names follow the `should{Action}When{Condition}` pattern for readability in surefire reports.

---

## 38. Makefile — Local CI Automation

### Why a Makefile
A `Makefile` provides a standard interface for common development tasks. Any team member can run `make ci` to reproduce the full CI pipeline locally before pushing. This catches failures early.

### Phony Targets
```makefile
.PHONY: test coverage lint build up down clean ci
```
`.PHONY` declares targets that are not file names. Without this, `make test` would check if a file named `test` exists rather than running the target.

### Chaining Targets
```makefile
ci: lint test coverage build
```
`make ci` runs all four targets in order. If any fails, Make stops immediately. This mirrors what a GitHub Actions CI pipeline would do.

### Local vs CI Parity
Running the exact same commands locally (`make ci`) as in CI (`GitHub Actions`) eliminates the "it works on my machine" problem. Checkstyle, tests, coverage thresholds, and builds all verify before any code is pushed.

---

## 39. Common Pitfalls & Lessons Learned

### Never Use `float` or `double` for Money
Floating-point numbers cannot represent most decimal fractions exactly. `0.1 + 0.2` produces `0.30000000000000004` in IEEE 754. Use `NUMERIC(19,2)` in PostgreSQL and `BigDecimal` in Java for all monetary values.

### JWT Secrets Must Be Strong
A weak or short JWT secret can be brute-forced offline. The secret should be at least 256 bits (32 bytes) of cryptographically random data. Generating it with `openssl rand -base64 64` produces a 512-bit secret suitable for HS256.

### Clear ThreadLocals in `finally`
If a `ThreadLocal` is set in a filter or middleware and not cleared, the value leaks to the next request that reuses the same thread from the pool. Always clear in a `finally` block, not just in the happy path.

### `ON DELETE CASCADE` vs Application-Level Deletion
Relying on `ON DELETE CASCADE` is simpler than writing deletion logic in application code, but it can cause silent data loss. When deleting a user, all expenses, investments, loans, and SIPs are deleted immediately. Ensure the API endpoint that deletes users has appropriate authorization checks (@PreAuthorize("hasRole('ADMIN')") or similar).

### CORS Must Match Exactly
CORS errors are common in development. The `origin` header sent by the browser must exactly match one of the allowed origins including protocol (`http://` vs `https://`), hostname, and port. `http://localhost:5173` and `http://localhost:3000` are different origins.

### `sslmode=require` is Not Optional for Supabase
Omitting `sslmode=require` in the JDBC URL causes the connection to be rejected by Supabase. The error message from PostgreSQL (`FATAL: SSL required`) can be confusing if the developer does not know to look for this.

### Connection Pool Size on Free Tier
Supabase free tier allows 25 connections. If another tool (a database GUI, Flyway manual run, PgBouncer default) is also consuming connections simultaneously, the application may fail to acquire a connection from its pool. Keeping `maximum-pool-size` small leaves headroom for these tools.

### Flyway SHA-256 Checksums
Flyway stores a checksum of each applied migration. If an applied migration file is modified (even whitespace changes), the next startup fails with a checksum mismatch. Migrations are immutable by design — create a new migration file for every schema change instead of editing an existing one.

### `SessionCreationPolicy.STATELESS` and `HttpSession`
When stateless session policy is configured, Spring Security does not create `HttpSession`. Code that calls `request.getSession()` will still create a session — it bypasses Spring Security's configuration. Be explicit: use `request.getSession(false)` (returns null if no session exists).

### Two-Step Import Pattern Prevents Duplicates
When importing statement data, attempting to import everything in one step risks duplicate records if the import crashes halfway. The preview-then-confirm two-step pattern ensures the user sees exactly what will be imported and prevents partial imports.

### `BaseEncoding` vs `Base64` in Java
`java.util.Base64` has three variants: `Base64.getEncoder()` (standard), `Base64.getUrlEncoder()` (URL-safe, no padding), and `Base64.getMimeEncoder()` (line-wrapped). JWT tokens use URL-safe Base64. Using the wrong variant produces tokens with `+`, `/`, `=` characters that break URL encoding.

### React `useEffect` Cleanup
When a `useEffect` sets up a subscription or timer, it must return a cleanup function. Without cleanup, updating state after the component unmounts causes the "Can't perform a state update on an unmounted component" warning (and can cause memory leaks):
```typescript
useEffect(() => {
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
}, []);
```

### Local Vault Mode — Keeping Implementations in Sync
Every time a new calculation or field is added to the server-side services, the corresponding local implementation in `data-context.tsx` must be updated. A type divergence will be caught at compile time by TypeScript, but a logic divergence (same field name, different calculation) will not. Test both modes when adding features.

### Proxy SSL in Nginx
When Nginx proxies to an HTTPS upstream (e.g., Railway internal service over TLS), `proxy_ssl_server_name on` must be set. Without it, the SSL handshake uses the IP address as the server name, which often fails certificate validation because the certificate is bound to a hostname.

### Static Asset Cache-Busting
Far-future cache headers (`Cache-Control: immutable`) only work correctly with content-addressed filenames. Vite generates these automatically. If a custom asset is placed in the `public/` directory with a static name, it must not be given a 1-year cache header because there is no cache-busting mechanism when it changes.

---

*This document covers the full stack — from SQL data types to WebCrypto key derivation — and all the infrastructure decisions that connect them. It was written while the code was still fresh to capture not just what was built, but why each decision was made.*
