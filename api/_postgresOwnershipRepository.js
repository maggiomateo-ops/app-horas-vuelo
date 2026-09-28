import crypto from "node:crypto";

import { withPostgresTransaction } from "./_postgres.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHARE_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const OWNER_KINDS = new Set(["CREATOR_PERSON", "PERSON", "ORGANIZATION"]);
const ALLOWED_INPUT_FIELDS = new Set(["aircraftId", "owners"]);
const OWNER_FIELDS = Object.freeze({
  CREATOR_PERSON: new Set(["kind", "ownershipShare"]),
  PERSON: new Set(["kind", "fullName", "email", "countryCode", "ownershipShare"]),
  ORGANIZATION: new Set([
    "kind",
    "organizationName",
    "countryCode",
    "ownershipShare",
  ]),
});

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, label, statusCode = 400) {
  const normalized = String(value || "").trim();

  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError(
      `${label} no es un UUID valido.`,
      "INVALID_CANONICAL_ID",
      statusCode
    );
  }

  return normalized;
}

function requireObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw repositoryError(message, "INVALID_OWNERSHIP_INPUT", 400);
  }
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw repositoryError(
      `${field} es obligatorio.`,
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }

  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw repositoryError(
      `${field} debe ser texto.`,
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }
  return value.trim() || null;
}

function normalizeCountryCode(value) {
  const countryCode = optionalText(value, "countryCode");
  if (countryCode === null) return null;
  const normalized = countryCode.toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw repositoryError(
      "countryCode debe ser un codigo ISO de dos letras.",
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }

  return normalized;
}

function normalizeShare(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw repositoryError(
      "ownershipShare debe ser un decimal mayor a cero y menor o igual a 100.",
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }

  const raw = String(value).trim();
  const match = SHARE_PATTERN.exec(raw);
  if (!match) {
    throw repositoryError(
      "ownershipShare debe tener como maximo dos decimales.",
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }

  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000) {
    throw repositoryError(
      "ownershipShare debe ser un decimal mayor a cero y menor o igual a 100.",
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }

  return { cents, decimal: (cents / 100).toFixed(2) };
}

function assertAllowedFields(input, allowedFields) {
  const unsupported = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unsupported.length > 0) {
    throw repositoryError(
      "El payload contiene campos no soportados para ownership canonico.",
      "UNSUPPORTED_OWNERSHIP_FIELDS",
      422
    );
  }
}

function normalizeOwner(owner) {
  requireObject(owner, "Cada owner debe ser un objeto JSON.");
  const kind = String(owner.kind || "").trim().toUpperCase();

  if (!OWNER_KINDS.has(kind)) {
    throw repositoryError(
      "kind no tiene un valor permitido.",
      "INVALID_OWNERSHIP_BUSINESS_PAYLOAD",
      422
    );
  }

  assertAllowedFields(owner, OWNER_FIELDS[kind]);
  const share = normalizeShare(owner.ownershipShare);

  if (kind === "CREATOR_PERSON") {
    return { kind, ownershipShare: share.decimal, shareCents: share.cents };
  }

  if (kind === "PERSON") {
    return {
      kind,
      fullName: requireText(owner.fullName, "fullName"),
      email: optionalText(owner.email, "email")?.toLowerCase() || null,
      countryCode: normalizeCountryCode(owner.countryCode),
      ownershipShare: share.decimal,
      shareCents: share.cents,
    };
  }

  return {
    kind,
    organizationName: requireText(owner.organizationName, "organizationName"),
    countryCode: normalizeCountryCode(owner.countryCode),
    ownershipShare: share.decimal,
    shareCents: share.cents,
  };
}

export function normalizeOwnershipSetupInput(input) {
  requireObject(input, "El payload de ownership debe ser un objeto JSON.");
  assertAllowedFields(input, ALLOWED_INPUT_FIELDS);
  const aircraftId = normalizeUuid(input.aircraftId, "aircraftId");

  if (!Array.isArray(input.owners) || input.owners.length === 0) {
    throw repositoryError(
      "owners debe contener al menos un propietario.",
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }

  const owners = input.owners.map(normalizeOwner);
  const creatorCount = owners.filter((owner) => owner.kind === "CREATOR_PERSON").length;
  if (creatorCount > 1) {
    throw repositoryError(
      "CREATOR_PERSON puede declararse una sola vez.",
      "INVALID_OWNERSHIP_INPUT",
      400
    );
  }

  const totalCents = owners.reduce((sum, owner) => sum + owner.shareCents, 0);
  if (totalCents !== 10_000) {
    throw repositoryError(
      "La suma de ownershipShare debe ser exactamente 100.00.",
      "INVALID_OWNERSHIP_TOTAL",
      400
    );
  }

  return { aircraftId, owners };
}

async function requireOwnershipAccess(client, userId, aircraftId) {
  const { rows } = await client.query(
    `
      SELECT membership.membership_id
      FROM app.users user_account
      JOIN app.aircraft_memberships membership
        ON membership.user_id = user_account.user_id
      JOIN app.aircraft aircraft
        ON aircraft.aircraft_id = membership.aircraft_id
      JOIN app.aircraft_membership_capabilities capability
        ON capability.membership_id = membership.membership_id
      WHERE user_account.user_id = $1::uuid
        AND user_account.status = 'ACTIVE'
        AND aircraft.aircraft_id = $2::uuid
        AND aircraft.status = 'ACTIVE'
        AND membership.status = 'ACTIVE'
        AND capability.capability = 'MANAGE_OWNERSHIP'
        AND capability.revoked_at IS NULL
      LIMIT 2
    `,
    [userId, aircraftId]
  );

  if (rows.length !== 1) {
    throw repositoryError(
      "No tenes permiso para configurar ownership de esta aeronave.",
      "OWNERSHIP_ACCESS_DENIED",
      403
    );
  }
}

async function resolveCreatorPerson(client, userId) {
  const { rows } = await client.query(
    `
      SELECT person.person_id
      FROM app.user_person_links user_person
      JOIN app.persons person ON person.person_id = user_person.person_id
      WHERE user_person.user_id = $1::uuid
        AND user_person.verified_at IS NOT NULL
        AND person.status = 'ACTIVE'
      LIMIT 2
    `,
    [userId]
  );

  if (rows.length !== 1) {
    throw repositoryError(
      "No se pudo resolver la persona canonica del usuario.",
      "CREATOR_PERSON_NOT_RESOLVED",
      409
    );
  }

  return normalizeUuid(rows[0].person_id, "personId", 500);
}

async function resolveOrCreateCreatorParty(client, personId, randomUUID) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `app-horas:person-party:${personId}`,
  ]);
  const { rows } = await client.query(
    `
      SELECT party_id, status
      FROM app.parties
      WHERE party_type = 'PERSON' AND person_id = $1::uuid
      LIMIT 2
    `,
    [personId]
  );

  if (rows.length > 1 || (rows[0] && rows[0].status !== "ACTIVE")) {
    throw repositoryError(
      "La party canonica del usuario no esta disponible.",
      "CREATOR_PARTY_NOT_ACTIVE",
      409
    );
  }

  if (rows.length === 1) return rows[0].party_id;

  const partyId = randomUUID();
  await client.query(
    `
      INSERT INTO app.parties (
        party_id, party_type, person_id, organization_name,
        country_code, status, created_at, updated_at
      ) VALUES (
        $1::uuid, 'PERSON', $2::uuid, NULL,
        NULL, 'ACTIVE', transaction_timestamp(), transaction_timestamp()
      )
    `,
    [partyId, personId]
  );
  return partyId;
}

async function createExplicitPersonParty(client, owner, randomUUID) {
  const personId = randomUUID();
  const partyId = randomUUID();
  await client.query(
    `
      INSERT INTO app.persons (
        person_id, full_name, email, phone, license_number, notes,
        status, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::text, $3::text, NULL, NULL, NULL,
        'ACTIVE', transaction_timestamp(), transaction_timestamp()
      )
    `,
    [personId, owner.fullName, owner.email]
  );
  await client.query(
    `
      INSERT INTO app.parties (
        party_id, party_type, person_id, organization_name,
        country_code, status, created_at, updated_at
      ) VALUES (
        $1::uuid, 'PERSON', $2::uuid, NULL,
        $3::char(2), 'ACTIVE', transaction_timestamp(), transaction_timestamp()
      )
    `,
    [partyId, personId, owner.countryCode]
  );
  return partyId;
}

async function createOrganizationParty(client, owner, randomUUID) {
  const partyId = randomUUID();
  await client.query(
    `
      INSERT INTO app.parties (
        party_id, party_type, person_id, organization_name,
        country_code, status, created_at, updated_at
      ) VALUES (
        $1::uuid, 'ORGANIZATION', NULL, $2::text,
        $3::char(2), 'ACTIVE', transaction_timestamp(), transaction_timestamp()
      )
    `,
    [partyId, owner.organizationName, owner.countryCode]
  );
  return partyId;
}

export function createPostgresOwnershipRepository({
  transaction = withPostgresTransaction,
  randomUUID = crypto.randomUUID,
} = {}) {
  return async function setupInitialAircraftOwnership({ userId, input }) {
    const normalizedUserId = normalizeUuid(userId, "userId", 403);
    const normalizedInput = normalizeOwnershipSetupInput(input);
    const requestId = randomUUID();

    return transaction(
      async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `app-horas:aircraft-ownership:${normalizedInput.aircraftId}`,
        ]);
        await requireOwnershipAccess(
          client,
          normalizedUserId,
          normalizedInput.aircraftId
        );

        const { rows: currentRows } = await client.query(
          `
            SELECT ownership_interest_id
            FROM app.aircraft_ownership_interests
            WHERE aircraft_id = $1::uuid AND effective_to_at IS NULL
            FOR UPDATE
          `,
          [normalizedInput.aircraftId]
        );
        if (currentRows.length > 0) {
          throw repositoryError(
            "La propiedad legal de la aeronave ya esta configurada.",
            "OWNERSHIP_ALREADY_CONFIGURED",
            409
          );
        }

        const interests = [];
        for (const owner of normalizedInput.owners) {
          let partyId;
          if (owner.kind === "CREATOR_PERSON") {
            const personId = await resolveCreatorPerson(client, normalizedUserId);
            partyId = await resolveOrCreateCreatorParty(client, personId, randomUUID);
          } else if (owner.kind === "PERSON") {
            partyId = await createExplicitPersonParty(client, owner, randomUUID);
          } else {
            partyId = await createOrganizationParty(client, owner, randomUUID);
          }

          const ownershipInterestId = randomUUID();
          await client.query(
            `
              INSERT INTO app.aircraft_ownership_interests (
                ownership_interest_id, aircraft_id, party_id, ownership_share,
                effective_from_at, effective_to_at, created_by_user_id, created_at
              ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4::numeric(5,2),
                transaction_timestamp(), NULL, $5::uuid, transaction_timestamp()
              )
            `,
            [
              ownershipInterestId,
              normalizedInput.aircraftId,
              partyId,
              owner.ownershipShare,
              normalizedUserId,
            ]
          );
          interests.push({
            ownership_interest_id: ownershipInterestId,
            party_id: partyId,
            party_type: owner.kind === "ORGANIZATION" ? "ORGANIZATION" : "PERSON",
            ownership_share: owner.ownershipShare,
          });
        }

        const { rows: totalRows } = await client.query(
          `
            SELECT COALESCE(sum(ownership_share), 0)::text AS ownership_total
            FROM app.aircraft_ownership_interests
            WHERE aircraft_id = $1::uuid AND effective_to_at IS NULL
          `,
          [normalizedInput.aircraftId]
        );
        const total = normalizeShare(totalRows[0]?.ownership_total || "0");
        if (total.cents !== 10_000) {
          throw repositoryError(
            "El total canonico de ownership no es valido.",
            "OWNERSHIP_TOTAL_INVARIANT_FAILED",
            500
          );
        }

        await client.query(
          `
            INSERT INTO audit.audit_events (
              request_id, actor_type, actor_user_id, operation_source,
              aircraft_id, entity_type, entity_id, entity_key,
              action_code, before_state, after_state, reason, metadata,
              payload_version
            ) VALUES (
              $1::uuid, 'USER', $2::uuid, 'MANUAL',
              $3::uuid, 'AIRCRAFT_OWNERSHIP', $3::uuid, $4::jsonb,
              'OWNERSHIP_CONFIGURED', $5::jsonb, $6::jsonb,
              'Canonical initial legal ownership setup', $7::jsonb, 1
            )
          `,
          [
            requestId,
            normalizedUserId,
            normalizedInput.aircraftId,
            JSON.stringify({ aircraft_id: normalizedInput.aircraftId }),
            JSON.stringify({ ownership_interests: [] }),
            JSON.stringify({ ownership_interests: interests }),
            JSON.stringify({ contract: "D-252" }),
          ]
        );

        return {
          ok: true,
          aircraftId: normalizedInput.aircraftId,
          ownershipConfigured: true,
          ownershipTotal: total.cents / 100,
          flightWritesReady: total.cents === 10_000,
        };
      },
      { isolationLevel: "SERIALIZABLE" }
    );
  };
}

export const setupInitialAircraftOwnershipInPostgres =
  createPostgresOwnershipRepository();
