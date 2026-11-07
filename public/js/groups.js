// Devices and subassemblies grouped by what sort of thing they are
// (meta.categories), as the editor lists them: in the Add menus, the Add
// device dialog and a surface's panel.

/** [[the category's name, [type names ...]]] for the categories `names` (in
the editor's order already) have any of. */
export function byCategory(meta, names) {
  return meta.categories
    .map(([category, label]) => [label, names.filter((n) => meta.types[n].category === category)])
    .filter(([, members]) => members.length);
}

/** A <select> of `names`, grouped by category when there's more than one,
`current` (or the first) chosen. */
export function typeSelect(meta, names, current = null) {
  const select = document.createElement("select");
  const option = (n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = meta.types[n].displayName;
    o.title = meta.types[n].description || n;
    return o;
  };
  const groups = byCategory(meta, names);
  if (groups.length < 2) select.append(...names.map(option));
  else {
    for (const [label, members] of groups) {
      const group = document.createElement("optgroup");
      group.label = label;
      group.append(...members.map(option));
      select.append(group);
    }
  }
  if (current && names.includes(current)) select.value = current;
  return select;
}
