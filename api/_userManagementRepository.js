import crypto from "node:crypto";
import {
  appendSpreadsheetValues,
  batchGetSpreadsheetValues,
  batchUpdateSpreadsheetValues,
} from "./_googleSheets.js";

const MANAGEMENT_RANGES = [
  "USUARIOS!A:K",
  "PERMISOS!A:H",
  "AERONAVES!A:H",
  "AUDIT_LOG!A:H",
];

const USER_HEADERS = [
  "user_id",
  "email",
  "nombre",
  "estado",
  "google_sub",
  "telefono",
  "dni",
  "licencia",
  "is_admin",
  "created_at",
  "updated_at",
];

const PERMISSION_HEADERS = [
  "user_id",
  "aircraft_id",
  "rol",
  "estado",
  "granted_by",
  "granted_at",
  "revoked_by",
  "revoked_at",
];

const AIRCRAFT_HEADERS = [
  "aircraft_id",
  "matricula",
  "fabricante",
  "modelo",
  "spreadsheet_id",
  "estado",
];

const AUDIT_HEADERS = [
  "audit_id",
  "created_at",
  "actor_user_id",
  "action",
  "entity_type",
  "entity_id",
  "aircraft_id",
  "details_json",
];

const VALID_USER_STATES = ["ACTIVO", "INACTIVO"];
const VALID_PERMISSION_STATES = ["ACTIVO", "INACTIVO"];
const VALID_PERMISSION_ROLES = ["OWNER", "PILOT", "VIEWER"];

function repositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getAdminSpreadsheetId() {
  const spreadsheetId = String(process.env.ADMIN_SPREADSHEET_ID || "").trim();

  if (!spreadsheetId) {
    throw new Error("Falta ADMIN_SPREADSHEET_ID en variables de entorno.");
  }

  return spreadsheetId;
}

function rowsToRecords(values, requiredHeaders, sheetName) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`La hoja ${sheetName} no tiene encabezados.`);
  }

  const headers = values[0].map((value) => String(value ?? "").trim());
  const indexes = requiredHeaders.map((header) => headers.indexOf(header));

  if (indexes.some((index) => index === -1)) {
    throw new Error(`Faltan columnas requeridas en ${sheetName}.`);
  }

  return values.slice(1).map((row, rowOffset) =>
    requiredHeaders.reduce(
      (record, header, index) => ({
        ...record,
        [header]: row[indexes[index]] ?? "",
        __rowNumber: rowOffset + 2,
      }),
      {}
    )
  );
}

async function readManagementData() {
  const spreadsheetId = getAdminSpreadsheetId();
  const [userValues, permissionValues, aircraftValues, auditValues] =
    await batchGetSpreadsheetValues(spreadsheetId, MANAGEMENT_RANGES);

  return {
    spreadsheetId,
    users: rowsToRecords(userValues, USER_HEADERS, "USUARIOS"),
    permissions: rowsToRecords(permissionValues, PERMISSION_HEADERS, "PERMISOS"),
    aircrafts: rowsToRecords(aircraftValues, AIRCRAFT_HEADERS, "AERONAVES"),
    audits: rowsToRecords(auditValues, AUDIT_HEADERS, "AUDIT_LOG"),
  };
}

function normalize(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return normalize(value).toUpperCase();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function normalizeBoolean(value) {
  return value === true || normalizeUpper(value) === "TRUE";
}

function assertValidUserRecord(user) {
  const state = normalizeUpper(user?.estado);

  if (!VALID_USER_STATES.includes(state)) {
    throw repositoryError("El usuario tiene un estado invalido.", "INTEGRITY_ERROR");
  }

  return state;
}

function assertValidPermissionRecord(permission) {
  const role = normalizeUpper(permission?.rol);
  const state = normalizeUpper(permission?.estado);

  if (!VALID_PERMISSION_ROLES.includes(role) || !VALID_PERMISSION_STATES.includes(state)) {
    throw repositoryError("El permiso tiene rol o estado invalido.", "INTEGRITY_ERROR");
  }

  return { role, state };
}

function findSingleBy(records, predicate, entityName) {
  const matches = records.filter(predicate);

  if (matches.length > 1) {
    throw repositoryError(`Hay registros duplicados para ${entityName}.`, "INTEGRITY_ERROR");
  }

  return matches[0] ?? null;
}

function findUserById(users, userId) {
  const normalizedUserId = normalize(userId);
  return findSingleBy(
    users,
    (user) => normalize(user.user_id) === normalizedUserId,
    `el usuario ${normalizedUserId}`
  );
}

function findUserByEmail(users, email) {
  const normalizedEmail = normalizeEmail(email);
  return findSingleBy(
    users,
    (user) => normalizeEmail(user.email) === normalizedEmail,
    `el email ${normalizedEmail}`
  );
}

function requireActiveActor(data, actorUserId) {
  const actor = findUserById(data.users, actorUserId);

  if (!actor) {
    throw repositoryError("El usuario autenticado no esta activo.", "USER_NOT_AUTHORIZED");
  }

  if (assertValidUserRecord(actor) !== "ACTIVO") {
    throw repositoryError("El usuario autenticado no esta activo.", "USER_NOT_AUTHORIZED");
  }

  return actor;
}

function requireAdminActor(data, actorUserId) {
  const actor = requireActiveActor(data, actorUserId);

  if (!normalizeBoolean(actor.is_admin)) {
    throw repositoryError("Se requiere privilegio de Admin.", "FORBIDDEN");
  }

  return actor;
}

function findAircraftById(aircrafts, aircraftId) {
  const normalizedAircraftId = normalize(aircraftId);
  const aircraft = findSingleBy(
    aircrafts,
    (item) => normalize(item.aircraft_id) === normalizedAircraftId,
    `la aeronave ${normalizedAircraftId}`
  );

  if (!aircraft) {
    throw repositoryError("La aeronave no existe.", "AIRCRAFT_NOT_FOUND");
  }

  return aircraft;
}

function requireActiveAircraft(aircrafts, aircraftId) {
  const aircraft = findAircraftById(aircrafts, aircraftId);

  if (normalizeUpper(aircraft.estado) !== "ACTIVA") {
    throw repositoryError("La aeronave no esta activa.", "AIRCRAFT_NOT_ACTIVE");
  }

  return aircraft;
}

function getPermissionMatches(permissions, userId, aircraftId) {
  const normalizedUserId = normalize(userId);
  const normalizedAircraftId = normalize(aircraftId);
  return permissions.filter(
    (permission) =>
      normalize(permission.user_id) === normalizedUserId &&
      normalize(permission.aircraft_id) === normalizedAircraftId
  );
}

function getSinglePermission(permissions, userId, aircraftId) {
  const matches = getPermissionMatches(permissions, userId, aircraftId);

  if (matches.length > 1) {
    throw repositoryError(
      "Existen multiples permisos para el usuario y la aeronave.",
      "INTEGRITY_ERROR"
    );
  }

  const permission = matches[0] ?? null;

  if (permission) {
    assertValidPermissionRecord(permission);
  }

  return permission;
}

function authorizeAircraftManager(data, actorUserId, aircraftId) {
  const actor = requireActiveActor(data, actorUserId);
  const normalizedAircraftId = normalize(aircraftId);
  const isAdmin = normalizeBoolean(actor.is_admin);

  if (!isAdmin) {
    const ownerPermission = getSinglePermission(
      data.permissions,
      actor.user_id,
      normalizedAircraftId
    );

    if (
      !ownerPermission ||
      normalizeUpper(ownerPermission.rol) !== "OWNER" ||
      normalizeUpper(ownerPermission.estado) !== "ACTIVO"
    ) {
      throw repositoryError("Se requiere ser Owner activo.", "FORBIDDEN");
    }
  }

  const aircraft = requireActiveAircraft(data.aircrafts, normalizedAircraftId);
  return { actor, aircraft, isAdmin };
}

function getNextRow(records) {
  return records.reduce(
    (maximum, record) => Math.max(maximum, Number(record.__rowNumber) || 1),
    1
  ) + 1;
}

function generateUserId(users) {
  const maximum = users.reduce((currentMaximum, user) => {
    const match = /^U(\d+)$/.exec(normalizeUpper(user.user_id));
    return match ? Math.max(currentMaximum, Number(match[1])) : currentMaximum;
  }, 2);

  return `U${String(maximum + 1).padStart(3, "0")}`;
}

function createAuditRow({
  actorUserId,
  action,
  entityType,
  entityId,
  aircraftId = "",
  details,
  createdAt,
}) {
  return [
    `${Date.now()}-${crypto.randomUUID()}`,
    createdAt,
    normalize(actorUserId),
    action,
    entityType,
    entityId,
    normalize(aircraftId),
    JSON.stringify(details),
  ];
}

function hasAudit(data, auditId) {
  return data.audits.some((audit) => normalize(audit.audit_id) === auditId);
}

async function repairMissingAudits(verification, auditRows) {
  let missingRows = auditRows.filter((row) => !hasAudit(verification, row[0]));

  if (!missingRows.length) {
    return verification;
  }

  const freshData = await readManagementData();
  missingRows = missingRows.filter((row) => !hasAudit(freshData, row[0]));

  if (!missingRows.length) {
    return freshData;
  }

  await appendSpreadsheetValues(freshData.spreadsheetId, "AUDIT_LOG!A:H", missingRows);
  const repairedData = await readManagementData();

  if (missingRows.some((row) => !hasAudit(repairedData, row[0]))) {
    throw repositoryError("No se pudo reparar AUDIT_LOG.", "WRITE_VERIFICATION_FAILED");
  }

  return repairedData;
}

async function verifyBusinessAndAudits(verifyBusiness, auditRows) {
  const verification = await readManagementData();
  verifyBusiness(verification);
  return repairMissingAudits(verification, auditRows);
}

function assertUserMatches(user, expected) {
  const matches =
    normalize(user.user_id) === expected.user_id &&
    normalizeEmail(user.email) === expected.email &&
    normalize(user.nombre) === expected.nombre &&
    assertValidUserRecord(user) === expected.estado &&
    normalize(user.google_sub) === expected.google_sub &&
    normalize(user.telefono) === expected.telefono &&
    normalize(user.dni) === expected.dni &&
    normalize(user.licencia) === expected.licencia &&
    normalizeBoolean(user.is_admin) === expected.is_admin &&
    normalize(user.created_at) === expected.created_at &&
    normalize(user.updated_at) === expected.updated_at;

  if (!matches) {
    throw repositoryError("No se pudo verificar el usuario escrito.", "WRITE_VERIFICATION_FAILED");
  }
}

function assertPermissionMatches(permission, expected) {
  const normalized = assertValidPermissionRecord(permission);
  const matches =
    normalize(permission.user_id) === expected.user_id &&
    normalize(permission.aircraft_id) === expected.aircraft_id &&
    normalized.role === expected.rol &&
    normalized.state === expected.estado &&
    normalize(permission.granted_by) === expected.granted_by &&
    normalize(permission.granted_at) === expected.granted_at &&
    normalize(permission.revoked_by) === expected.revoked_by &&
    normalize(permission.revoked_at) === expected.revoked_at;

  if (!matches) {
    throw repositoryError("No se pudo verificar el permiso escrito.", "WRITE_VERIFICATION_FAILED");
  }
}

function permissionSnapshot(permission) {
  if (!permission) {
    return null;
  }

  const { role, state } = assertValidPermissionRecord(permission);
  return {
    rowNumber: Number(permission.__rowNumber),
    role,
    state,
    grantedBy: normalize(permission.granted_by),
    grantedAt: normalize(permission.granted_at),
    revokedBy: normalize(permission.revoked_by),
    revokedAt: normalize(permission.revoked_at),
  };
}

function assertPermissionSnapshotUnchanged(previousSnapshot, currentPermission) {
  const currentSnapshot = permissionSnapshot(currentPermission);

  if (JSON.stringify(previousSnapshot) !== JSON.stringify(currentSnapshot)) {
    throw repositoryError("El permiso cambio durante la operacion.", "INTEGRITY_ERROR");
  }
}

function publicMutationResult({ userId, aircraftId, role, state, changed }) {
  return {
    changed,
    ...(userId ? { user_id: userId } : {}),
    ...(aircraftId ? { aircraft_id: aircraftId } : {}),
    ...(role ? { rol: role } : {}),
    ...(state ? { estado: state } : {}),
  };
}

export async function createUserByAdmin(actorUserId, input) {
  const email = normalizeEmail(input.email);
  const initialData = await readManagementData();
  requireAdminActor(initialData, actorUserId);

  if (findUserByEmail(initialData.users, email)) {
    throw repositoryError("Ya existe un usuario con ese email.", "EMAIL_CONFLICT");
  }

  const data = await readManagementData();
  const actor = requireAdminActor(data, actorUserId);

  if (findUserByEmail(data.users, email)) {
    throw repositoryError("Ya existe un usuario con ese email.", "EMAIL_CONFLICT");
  }

  const userId = generateUserId(data.users);
  const userRowNumber = getNextRow(data.users);
  const auditRowNumber = getNextRow(data.audits);
  const now = new Date().toISOString();
  const expectedUser = {
    user_id: userId,
    email,
    nombre: normalize(input.nombre),
    estado: "ACTIVO",
    google_sub: "",
    telefono: normalize(input.telefono),
    dni: normalize(input.dni),
    licencia: normalize(input.licencia),
    is_admin: input.is_admin === true,
    created_at: now,
    updated_at: now,
  };
  const userRow = [
    expectedUser.user_id,
    expectedUser.email,
    expectedUser.nombre,
    expectedUser.estado,
    expectedUser.google_sub,
    expectedUser.telefono,
    expectedUser.dni,
    expectedUser.licencia,
    expectedUser.is_admin,
    expectedUser.created_at,
    expectedUser.updated_at,
  ];
  const auditRow = createAuditRow({
    actorUserId: actor.user_id,
    action: "USER_CREATED",
    entityType: "USER",
    entityId: userId,
    details: { newEstado: "ACTIVO", isAdmin: input.is_admin === true },
    createdAt: now,
  });

  await batchUpdateSpreadsheetValues(data.spreadsheetId, [
    { range: `USUARIOS!A${userRowNumber}:K${userRowNumber}`, values: [userRow] },
    { range: `AUDIT_LOG!A${auditRowNumber}:H${auditRowNumber}`, values: [auditRow] },
  ]);

  await verifyBusinessAndAudits((verification) => {
    const createdUser = findUserById(verification.users, userId);
    if (!createdUser) {
      throw repositoryError("No se pudo verificar el usuario creado.", "WRITE_VERIFICATION_FAILED");
    }
    assertUserMatches(createdUser, expectedUser);
  }, [auditRow]);

  return publicMutationResult({ userId, state: "ACTIVO", changed: true });
}

export async function changeUserStatusByAdmin(actorUserId, targetUserId, requestedState) {
  const initialData = await readManagementData();
  const initialActor = requireAdminActor(initialData, actorUserId);
  const initialTarget = findUserById(initialData.users, targetUserId);

  if (!initialTarget) {
    throw repositoryError("El usuario no existe.", "USER_NOT_FOUND");
  }

  const state = normalizeUpper(requestedState);
  if (!VALID_USER_STATES.includes(state)) {
    throw repositoryError("El estado solicitado no es valido.", "VALIDATION_ERROR");
  }
  const previousState = assertValidUserRecord(initialTarget);

  if (normalize(initialActor.user_id) === normalize(initialTarget.user_id) && state === "INACTIVO") {
    throw repositoryError("No podes desactivar tu propio usuario.", "SELF_DEACTIVATION");
  }

  if (previousState === state) {
    return publicMutationResult({ userId: normalize(initialTarget.user_id), state, changed: false });
  }

  const data = await readManagementData();
  const actor = requireAdminActor(data, actorUserId);
  const target = findUserById(data.users, targetUserId);

  if (!target || Number(target.__rowNumber) !== Number(initialTarget.__rowNumber)) {
    throw repositoryError("El usuario cambio durante la operacion.", "INTEGRITY_ERROR");
  }

  if (assertValidUserRecord(target) !== previousState) {
    throw repositoryError("El usuario cambio durante la operacion.", "INTEGRITY_ERROR");
  }

  if (normalize(actor.user_id) === normalize(target.user_id) && state === "INACTIVO") {
    throw repositoryError("No podes desactivar tu propio usuario.", "SELF_DEACTIVATION");
  }

  const now = new Date().toISOString();
  const action = state === "ACTIVO" ? "USER_ACTIVATED" : "USER_DEACTIVATED";
  const auditRow = createAuditRow({
    actorUserId: actor.user_id,
    action,
    entityType: "USER",
    entityId: normalize(target.user_id),
    details: { previousEstado: previousState, newEstado: state },
    createdAt: now,
  });

  await batchUpdateSpreadsheetValues(data.spreadsheetId, [
    { range: `USUARIOS!D${target.__rowNumber}`, values: [[state]] },
    { range: `USUARIOS!K${target.__rowNumber}`, values: [[now]] },
    { range: `AUDIT_LOG!A${getNextRow(data.audits)}:H${getNextRow(data.audits)}`, values: [auditRow] },
  ]);

  const expectedUser = {
    user_id: normalize(target.user_id),
    email: normalizeEmail(target.email),
    nombre: normalize(target.nombre),
    estado: state,
    google_sub: normalize(target.google_sub),
    telefono: normalize(target.telefono),
    dni: normalize(target.dni),
    licencia: normalize(target.licencia),
    is_admin: normalizeBoolean(target.is_admin),
    created_at: normalize(target.created_at),
    updated_at: now,
  };

  await verifyBusinessAndAudits((verification) => {
    const updatedUser = findUserById(verification.users, target.user_id);
    if (!updatedUser) {
      throw repositoryError("No se pudo verificar el usuario actualizado.", "WRITE_VERIFICATION_FAILED");
    }
    assertUserMatches(updatedUser, expectedUser);
  }, [auditRow]);
  return publicMutationResult({ userId: normalize(target.user_id), state, changed: true });
}

export async function grantAircraftPermissionByAdmin(actorUserId, input) {
  const role = normalizeUpper(input.rol);
  if (!VALID_PERMISSION_ROLES.includes(role)) {
    throw repositoryError("El rol solicitado no es valido.", "VALIDATION_ERROR");
  }

  const initialData = await readManagementData();
  requireAdminActor(initialData, actorUserId);
  const initialUser = findUserById(initialData.users, input.user_id);

  if (!initialUser) {
    throw repositoryError("El usuario no existe.", "USER_NOT_FOUND");
  }

  if (assertValidUserRecord(initialUser) !== "ACTIVO") {
    throw repositoryError("El usuario no esta activo.", "USER_INACTIVE");
  }

  const initialAircraft = requireActiveAircraft(initialData.aircrafts, input.aircraft_id);
  const userId = normalize(initialUser.user_id);
  const aircraftId = normalize(initialAircraft.aircraft_id);
  const initialPermission = getSinglePermission(initialData.permissions, userId, aircraftId);
  const initialSnapshot = permissionSnapshot(initialPermission);
  const initialRole = initialPermission ? normalizeUpper(initialPermission.rol) : "";
  const initialState = initialPermission ? normalizeUpper(initialPermission.estado) : "";

  if (initialPermission && initialState === "ACTIVO" && initialRole === role) {
    return publicMutationResult({ userId, aircraftId, role, state: "ACTIVO", changed: false });
  }

  const data = await readManagementData();
  const actor = requireAdminActor(data, actorUserId);
  const user = findUserById(data.users, userId);
  if (!user || assertValidUserRecord(user) !== "ACTIVO") {
    throw repositoryError("El usuario cambio durante la operacion.", "INTEGRITY_ERROR");
  }
  requireActiveAircraft(data.aircrafts, aircraftId);
  const permission = getSinglePermission(data.permissions, userId, aircraftId);
  assertPermissionSnapshotUnchanged(initialSnapshot, permission);
  const previousRole = permission ? normalizeUpper(permission.rol) : "";
  const previousState = permission ? normalizeUpper(permission.estado) : "";

  const now = new Date().toISOString();
  const changeType = !permission
    ? "CREATED"
    : previousRole !== role
      ? "ROLE_CHANGED"
      : "REACTIVATED";
  const auditRow = createAuditRow({
    actorUserId: actor.user_id,
    action: "AIRCRAFT_ACCESS_GRANTED",
    entityType: "AIRCRAFT_ACCESS",
    entityId: `${userId}:${aircraftId}`,
    aircraftId,
    details: {
      changeType,
      previousRole,
      newRole: role,
      previousEstado: previousState,
      newEstado: "ACTIVO",
      source: "ADMIN",
    },
    createdAt: now,
  });
  const permissionUpdate = permission
    ? {
        range: `PERMISOS!C${permission.__rowNumber}:H${permission.__rowNumber}`,
        values: [[role, "ACTIVO", normalize(actor.user_id), now, "", ""]],
      }
    : {
        range: `PERMISOS!A${getNextRow(data.permissions)}:H${getNextRow(data.permissions)}`,
        values: [[userId, aircraftId, role, "ACTIVO", normalize(actor.user_id), now, "", ""]],
      };
  const expectedPermission = {
    user_id: userId,
    aircraft_id: aircraftId,
    rol: role,
    estado: "ACTIVO",
    granted_by: normalize(actor.user_id),
    granted_at: now,
    revoked_by: "",
    revoked_at: "",
  };

  await batchUpdateSpreadsheetValues(data.spreadsheetId, [
    permissionUpdate,
    { range: `AUDIT_LOG!A${getNextRow(data.audits)}:H${getNextRow(data.audits)}`, values: [auditRow] },
  ]);

  await verifyBusinessAndAudits((verification) => {
    const writtenPermission = getSinglePermission(verification.permissions, userId, aircraftId);
    if (!writtenPermission) {
      throw repositoryError("No se pudo verificar el permiso.", "WRITE_VERIFICATION_FAILED");
    }
    assertPermissionMatches(writtenPermission, expectedPermission);
  }, [auditRow]);
  return publicMutationResult({ userId, aircraftId, role, state: "ACTIVO", changed: true });
}

export async function revokeAircraftPermissionByAdmin(actorUserId, input) {
  const initialData = await readManagementData();
  requireAdminActor(initialData, actorUserId);
  const initialUser = findUserById(initialData.users, input.user_id);

  if (!initialUser) {
    throw repositoryError("El usuario no existe.", "USER_NOT_FOUND");
  }
  assertValidUserRecord(initialUser);

  const initialAircraft = findAircraftById(initialData.aircrafts, input.aircraft_id);
  const userId = normalize(initialUser.user_id);
  const aircraftId = normalize(initialAircraft.aircraft_id);
  const initialPermission = getSinglePermission(initialData.permissions, userId, aircraftId);

  if (!initialPermission) {
    throw repositoryError("El permiso no existe.", "PERMISSION_NOT_FOUND");
  }

  const initialSnapshot = permissionSnapshot(initialPermission);
  const role = normalizeUpper(initialPermission.rol);

  if (normalizeUpper(initialPermission.estado) === "INACTIVO") {
    return publicMutationResult({ userId, aircraftId, role, state: "INACTIVO", changed: false });
  }

  const data = await readManagementData();
  const actor = requireAdminActor(data, actorUserId);
  const user = findUserById(data.users, userId);
  if (!user) {
    throw repositoryError("El usuario cambio durante la operacion.", "INTEGRITY_ERROR");
  }
  assertValidUserRecord(user);
  findAircraftById(data.aircrafts, aircraftId);
  const permission = getSinglePermission(data.permissions, userId, aircraftId);
  assertPermissionSnapshotUnchanged(initialSnapshot, permission);

  const now = new Date().toISOString();
  const auditRow = createAuditRow({
    actorUserId: actor.user_id,
    action: "AIRCRAFT_ACCESS_REVOKED",
    entityType: "AIRCRAFT_ACCESS",
    entityId: `${userId}:${aircraftId}`,
    aircraftId,
    details: { previousEstado: "ACTIVO", newEstado: "INACTIVO", role, source: "ADMIN" },
    createdAt: now,
  });

  await batchUpdateSpreadsheetValues(data.spreadsheetId, [
    { range: `PERMISOS!D${permission.__rowNumber}`, values: [["INACTIVO"]] },
    { range: `PERMISOS!G${permission.__rowNumber}:H${permission.__rowNumber}`, values: [[normalize(actor.user_id), now]] },
    { range: `AUDIT_LOG!A${getNextRow(data.audits)}:H${getNextRow(data.audits)}`, values: [auditRow] },
  ]);

  const expectedPermission = {
    user_id: userId,
    aircraft_id: aircraftId,
    rol: role,
    estado: "INACTIVO",
    granted_by: normalize(permission.granted_by),
    granted_at: normalize(permission.granted_at),
    revoked_by: normalize(actor.user_id),
    revoked_at: now,
  };
  await verifyBusinessAndAudits((verification) => {
    const writtenPermission = getSinglePermission(verification.permissions, userId, aircraftId);
    if (!writtenPermission) {
      throw repositoryError("No se pudo verificar el permiso.", "WRITE_VERIFICATION_FAILED");
    }
    assertPermissionMatches(writtenPermission, expectedPermission);
  }, [auditRow]);
  return publicMutationResult({ userId, aircraftId, role, state: "INACTIVO", changed: true });
}

function prepareAircraftPilotMutation(data, actorUserId, input) {
  const manager = authorizeAircraftManager(data, actorUserId, input.aircraft_id);
  const aircraftId = normalize(manager.aircraft.aircraft_id);
  const existingUser = findUserByEmail(data.users, input.email);

  if (!existingUser) {
    if (!normalize(input.nombre)) {
      throw repositoryError("Falta nombre para crear el usuario.", "VALIDATION_ERROR");
    }
    return { ...manager, aircraftId, kind: "NEW_USER", user: null, permission: null };
  }

  if (assertValidUserRecord(existingUser) !== "ACTIVO") {
    throw repositoryError(
      "El usuario esta inactivo y requiere intervencion de Admin.",
      "USER_INACTIVE"
    );
  }

  const permission = getSinglePermission(
    data.permissions,
    existingUser.user_id,
    aircraftId
  );
  if (permission && normalizeUpper(permission.rol) !== "PILOT") {
    throw repositoryError(
      "El acceso existente requiere intervencion de Admin.",
      "ROLE_CONFLICT"
    );
  }

  return {
    ...manager,
    aircraftId,
    kind:
      permission && normalizeUpper(permission.estado) === "ACTIVO"
        ? "IDEMPOTENT"
        : "PERMISSION",
    user: existingUser,
    permission,
  };
}

export async function addAircraftPilot(actorUserId, input) {
  const initialData = await readManagementData();
  const initialDecision = prepareAircraftPilotMutation(initialData, actorUserId, input);
  if (initialDecision.kind === "IDEMPOTENT") {
    return publicMutationResult({
      userId: normalize(initialDecision.user.user_id),
      aircraftId: initialDecision.aircraftId,
      role: "PILOT",
      state: "ACTIVO",
      changed: false,
    });
  }

  const data = await readManagementData();
  const decision = prepareAircraftPilotMutation(data, actorUserId, input);
  if (
    initialDecision.kind === "PERMISSION" &&
    (decision.kind === "NEW_USER" ||
      normalize(decision.user?.user_id) !== normalize(initialDecision.user?.user_id) ||
      JSON.stringify(permissionSnapshot(decision.permission)) !==
        JSON.stringify(permissionSnapshot(initialDecision.permission)))
  ) {
    throw repositoryError("El acceso del piloto cambio durante la operacion.", "INTEGRITY_ERROR");
  }
  if (decision.kind === "IDEMPOTENT") {
    return publicMutationResult({
      userId: normalize(decision.user.user_id),
      aircraftId: decision.aircraftId,
      role: "PILOT",
      state: "ACTIVO",
      changed: false,
    });
  }

  const { actor, aircraftId, isAdmin, permission } = decision;
  const now = new Date().toISOString();
  const source = isAdmin ? "ADMIN" : "OWNER";

  if (decision.kind === "PERMISSION") {
    const userId = normalize(decision.user.user_id);
    const expectedPermission = {
      user_id: userId,
      aircraft_id: aircraftId,
      rol: "PILOT",
      estado: "ACTIVO",
      granted_by: normalize(actor.user_id),
      granted_at: now,
      revoked_by: "",
      revoked_at: "",
    };
    const auditRow = createAuditRow({
      actorUserId: actor.user_id,
      action: "AIRCRAFT_ACCESS_GRANTED",
      entityType: "AIRCRAFT_ACCESS",
      entityId: `${userId}:${aircraftId}`,
      aircraftId,
      details: {
        changeType: permission ? "REACTIVATED" : "CREATED",
        previousRole: permission ? "PILOT" : "",
        newRole: "PILOT",
        previousEstado: permission ? normalizeUpper(permission.estado) : "",
        newEstado: "ACTIVO",
        source,
      },
      createdAt: now,
    });
    const permissionUpdate = permission
      ? {
          range: `PERMISOS!C${permission.__rowNumber}:H${permission.__rowNumber}`,
          values: [["PILOT", "ACTIVO", normalize(actor.user_id), now, "", ""]],
        }
      : {
          range: `PERMISOS!A${getNextRow(data.permissions)}:H${getNextRow(data.permissions)}`,
          values: [[userId, aircraftId, "PILOT", "ACTIVO", normalize(actor.user_id), now, "", ""]],
        };

    await batchUpdateSpreadsheetValues(data.spreadsheetId, [
      permissionUpdate,
      { range: `AUDIT_LOG!A${getNextRow(data.audits)}:H${getNextRow(data.audits)}`, values: [auditRow] },
    ]);
    await verifyBusinessAndAudits((verification) => {
      const writtenPermission = getSinglePermission(verification.permissions, userId, aircraftId);
      if (!writtenPermission) {
        throw repositoryError("No se pudo verificar el permiso.", "WRITE_VERIFICATION_FAILED");
      }
      assertPermissionMatches(writtenPermission, expectedPermission);
    }, [auditRow]);
    return publicMutationResult({ userId, aircraftId, role: "PILOT", state: "ACTIVO", changed: true });
  }

  const userId = generateUserId(data.users);
  const expectedUser = {
    user_id: userId,
    email: normalizeEmail(input.email),
    nombre: normalize(input.nombre),
    estado: "ACTIVO",
    google_sub: "",
    telefono: normalize(input.telefono),
    dni: "",
    licencia: normalize(input.licencia),
    is_admin: false,
    created_at: now,
    updated_at: now,
  };
  const expectedPermission = {
    user_id: userId,
    aircraft_id: aircraftId,
    rol: "PILOT",
    estado: "ACTIVO",
    granted_by: normalize(actor.user_id),
    granted_at: now,
    revoked_by: "",
    revoked_at: "",
  };
  const userRow = [
    expectedUser.user_id,
    expectedUser.email,
    expectedUser.nombre,
    expectedUser.estado,
    expectedUser.google_sub,
    expectedUser.telefono,
    expectedUser.dni,
    expectedUser.licencia,
    expectedUser.is_admin,
    expectedUser.created_at,
    expectedUser.updated_at,
  ];
  const permissionRow = [
    expectedPermission.user_id,
    expectedPermission.aircraft_id,
    expectedPermission.rol,
    expectedPermission.estado,
    expectedPermission.granted_by,
    expectedPermission.granted_at,
    expectedPermission.revoked_by,
    expectedPermission.revoked_at,
  ];
  const userAudit = createAuditRow({
    actorUserId: actor.user_id,
    action: "USER_CREATED",
    entityType: "USER",
    entityId: userId,
    details: { newEstado: "ACTIVO", isAdmin: false, source },
    createdAt: now,
  });
  const permissionAudit = createAuditRow({
    actorUserId: actor.user_id,
    action: "AIRCRAFT_ACCESS_GRANTED",
    entityType: "AIRCRAFT_ACCESS",
    entityId: `${userId}:${aircraftId}`,
    aircraftId,
    details: { changeType: "CREATED", previousRole: "", newRole: "PILOT", previousEstado: "", newEstado: "ACTIVO", source },
    createdAt: now,
  });
  const auditRowNumber = getNextRow(data.audits);

  await batchUpdateSpreadsheetValues(data.spreadsheetId, [
    { range: `USUARIOS!A${getNextRow(data.users)}:K${getNextRow(data.users)}`, values: [userRow] },
    { range: `PERMISOS!A${getNextRow(data.permissions)}:H${getNextRow(data.permissions)}`, values: [permissionRow] },
    { range: `AUDIT_LOG!A${auditRowNumber}:H${auditRowNumber + 1}`, values: [userAudit, permissionAudit] },
  ]);
  await verifyBusinessAndAudits((verification) => {
    const createdUser = findUserById(verification.users, userId);
    const writtenPermission = getSinglePermission(verification.permissions, userId, aircraftId);
    if (!createdUser || !writtenPermission) {
      throw repositoryError("No se pudo verificar la escritura.", "WRITE_VERIFICATION_FAILED");
    }
    assertUserMatches(createdUser, expectedUser);
    assertPermissionMatches(writtenPermission, expectedPermission);
  }, [userAudit, permissionAudit]);

  return publicMutationResult({ userId, aircraftId, role: "PILOT", state: "ACTIVO", changed: true });
}

export async function revokeAircraftPilot(actorUserId, input) {
  const initialData = await readManagementData();
  const initialManager = authorizeAircraftManager(
    initialData,
    actorUserId,
    input.aircraft_id
  );
  const aircraftId = normalize(initialManager.aircraft.aircraft_id);
  const userId = normalize(input.user_id);
  const initialPermission = getSinglePermission(initialData.permissions, userId, aircraftId);

  if (!initialPermission) {
    throw repositoryError("El permiso PILOT no existe.", "PERMISSION_NOT_FOUND");
  }

  if (normalizeUpper(initialPermission.rol) !== "PILOT") {
    throw repositoryError("El permiso no corresponde a un Pilot.", "ROLE_CONFLICT");
  }

  if (normalizeUpper(initialPermission.estado) === "INACTIVO") {
    return publicMutationResult({
      userId,
      aircraftId,
      role: "PILOT",
      state: "INACTIVO",
      changed: false,
    });
  }

  const initialSnapshot = permissionSnapshot(initialPermission);
  const data = await readManagementData();
  const { actor, isAdmin } = authorizeAircraftManager(data, actorUserId, aircraftId);
  const permission = getSinglePermission(data.permissions, userId, aircraftId);
  assertPermissionSnapshotUnchanged(initialSnapshot, permission);

  const now = new Date().toISOString();
  const auditRow = createAuditRow({
    actorUserId: actor.user_id,
    action: "AIRCRAFT_ACCESS_REVOKED",
    entityType: "AIRCRAFT_ACCESS",
    entityId: `${userId}:${aircraftId}`,
    aircraftId,
    details: {
      previousEstado: "ACTIVO",
      newEstado: "INACTIVO",
      role: "PILOT",
      source: isAdmin ? "ADMIN" : "OWNER",
    },
    createdAt: now,
  });

  await batchUpdateSpreadsheetValues(data.spreadsheetId, [
    { range: `PERMISOS!D${permission.__rowNumber}`, values: [["INACTIVO"]] },
    { range: `PERMISOS!G${permission.__rowNumber}:H${permission.__rowNumber}`, values: [[normalize(actor.user_id), now]] },
    { range: `AUDIT_LOG!A${getNextRow(data.audits)}:H${getNextRow(data.audits)}`, values: [auditRow] },
  ]);

  const expectedPermission = {
    user_id: userId,
    aircraft_id: aircraftId,
    rol: "PILOT",
    estado: "INACTIVO",
    granted_by: normalize(permission.granted_by),
    granted_at: normalize(permission.granted_at),
    revoked_by: normalize(actor.user_id),
    revoked_at: now,
  };
  await verifyBusinessAndAudits((verification) => {
    const writtenPermission = getSinglePermission(verification.permissions, userId, aircraftId);
    if (!writtenPermission) {
      throw repositoryError("No se pudo verificar el permiso.", "WRITE_VERIFICATION_FAILED");
    }
    assertPermissionMatches(writtenPermission, expectedPermission);
  }, [auditRow]);
  return publicMutationResult({
    userId,
    aircraftId,
    role: "PILOT",
    state: "INACTIVO",
    changed: true,
  });
}
