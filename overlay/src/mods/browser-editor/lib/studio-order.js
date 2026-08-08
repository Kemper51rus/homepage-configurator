function serviceDisplayWeight(item, index) {
  const value = item?.config?.weight;

  if (value === undefined || value === null) {
    return (index + 1) * 100;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function orderStudioItems(items = [], type) {
  if (type !== "services") {
    return items;
  }

  return items
    .map((item, index) => ({
      index,
      item,
      weight: serviceDisplayWeight(item, index),
    }))
    .sort((left, right) => {
      const weightDifference = left.weight - right.weight;
      if (weightDifference !== 0) {
        return weightDifference;
      }

      const nameDifference = String(left.item?.name ?? "").localeCompare(
        String(right.item?.name ?? ""),
      );
      return nameDifference || left.index - right.index;
    })
    .map(({ item }) => item);
}
