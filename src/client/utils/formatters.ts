/** Format an ISO date string to a locale-friendly display string. */
export const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};
