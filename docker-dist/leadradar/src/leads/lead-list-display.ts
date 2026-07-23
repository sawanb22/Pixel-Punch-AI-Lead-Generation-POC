/** UI label for the auto-created default list (DB name stays "Default"). */
export function displayLeadListName(name: string): string {
  return name === "Default" ? "Project list" : name;
}

export function isDefaultLeadList(name: string): boolean {
  return name === "Default";
}
