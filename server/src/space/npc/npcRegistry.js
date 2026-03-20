const controllersByEntityID = new Map();

function registerController(controller) {
  if (!controller || !Number.isInteger(Number(controller.entityID))) {
    return null;
  }

  const normalizedController = {
    ...controller,
    entityID: Number(controller.entityID),
    systemID: Number(controller.systemID) || 0,
  };
  controllersByEntityID.set(normalizedController.entityID, normalizedController);
  return normalizedController;
}

function getControllerByEntityID(entityID) {
  return controllersByEntityID.get(Number(entityID) || 0) || null;
}

function unregisterController(entityID) {
  const normalizedEntityID = Number(entityID) || 0;
  const existing = controllersByEntityID.get(normalizedEntityID) || null;
  controllersByEntityID.delete(normalizedEntityID);
  return existing;
}

function listControllersBySystem(systemID) {
  const normalizedSystemID = Number(systemID) || 0;
  return [...controllersByEntityID.values()]
    .filter((controller) => Number(controller.systemID) === normalizedSystemID)
    .sort((left, right) => left.entityID - right.entityID);
}

function listControllers() {
  return [...controllersByEntityID.values()].sort(
    (left, right) =>
      (Number(left.systemID) || 0) - (Number(right.systemID) || 0) ||
      left.entityID - right.entityID,
  );
}

function clearControllers() {
  controllersByEntityID.clear();
}

module.exports = {
  registerController,
  getControllerByEntityID,
  unregisterController,
  listControllersBySystem,
  listControllers,
  clearControllers,
};
