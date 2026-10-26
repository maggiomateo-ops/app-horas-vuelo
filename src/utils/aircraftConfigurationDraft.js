export function componentKey(componentType, positionIndex) {
  return `${componentType}:${positionIndex}`;
}

export function syncComponents(current, engineCount, propellerCount) {
  const byKey = new Map(current.map((component) => [
    componentKey(component.componentType, component.positionIndex),
    component,
  ]));
  return [
    ...Array.from({ length: engineCount }, (_, index) => ({
      componentType: "ENGINE",
      positionIndex: index + 1,
    })),
    ...Array.from({ length: propellerCount }, (_, index) => ({
      componentType: "PROPELLER",
      positionIndex: index + 1,
    })),
  ].map((identity) => ({
    manufacturer: "",
    model: "",
    serialNumber: "",
    openingTisHours: "",
    installedOn: "",
    ...identity,
    ...(byKey.get(componentKey(identity.componentType, identity.positionIndex)) || {}),
  }));
}

