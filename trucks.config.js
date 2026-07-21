(() => {
  if (globalThis.DALNOBOYSHIKI2_TRUCK_CONFIG) {
    return;
  }

  const trucks = [
    {
      id: "classic",
      name: "Классическая кабина",
      shortName: "КЛАССИКА",
      cabinImage: "images/bottom-cabin@2x.png",
      fuelTankCapacityLiters: 500,
      fuelConsumptionLitersPer100Km: 32,
    },
    {
      id: "daf-95xf",
      name: "DAF 95XF",
      shortName: "DAF 95XF",
      cabinImage: "images/daf-95xf.png",
      fuelTankCapacityLiters: 355,
      fuelConsumptionLitersPer100Km: 34,
    },
  ].map((truck) => Object.freeze(truck));

  globalThis.DALNOBOYSHIKI2_TRUCK_CONFIG = Object.freeze({
    defaultTruckId: "classic",
    trucks: Object.freeze(trucks),
  });
})();
