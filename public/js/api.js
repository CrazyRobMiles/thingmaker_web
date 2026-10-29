// Talking to the thingmaker server.

async function check(response) {
  const type = response.headers.get("Content-Type") || "";
  if (type.includes("application/json")) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || response.statusText);
    return data;
  }
  if (!response.ok) throw new Error(response.statusText);
  return response;
}

export async function get(path, params = {}) {
  const q = new URLSearchParams(params).toString();
  return check(await fetch(q ? `${path}?${q}` : path));
}

export async function post(path, body = {}) {
  return check(await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

/** Upload a file from this computer to the server; resolves to its path
there. */
export async function upload(file, to = "uploads") {
  const response = await fetch(`/api/upload?${new URLSearchParams({ name: file.name, to })}`, { method: "POST", body: file });
  return (await check(response)).path;
}

/** The live build of a design: {parts: [{id, world, colour, vertices,
triangles}], problems}. */
export async function liveBuild(design) {
  const response = await fetch("/api/live", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ design }) });
  if (!response.ok) throw new Error(response.statusText);
  const buf = await response.arrayBuffer();
  const length = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, length)));
  const start = 4 + length + ((4 - ((4 + length) % 4)) % 4);
  const parts = header.parts.map((p) => ({
    id: p.id, world: p.world, colour: p.colour,
    vertices: new Float32Array(buf, start + p.vertexOffset, p.vertexCount),
    triangles: new Uint32Array(buf, start + p.triangleOffset, p.triangleCount),
  }));
  return { parts, problems: header.problems };
}

/** Follow a build: handlers.line(text) for each line of its log, then
handlers.end({result: "built" | "failed" | "stopped", problems, outDir}). */
export function buildEvents(id, handlers) {
  const source = new EventSource(`/api/build/events?id=${encodeURIComponent(id)}`);
  let ended = false;
  source.addEventListener("line", (e) => handlers.line(JSON.parse(e.data)));
  source.addEventListener("end", (e) => {
    ended = true;
    source.close();
    handlers.end(JSON.parse(e.data));
  });
  source.onerror = () => {
    if (!ended && source.readyState === EventSource.CLOSED) handlers.end({ result: "failed" });
  };
}

/** An STL file on the server, as an ArrayBuffer. */
export async function stlFile(path) {
  const response = await fetch(`/api/stl?${new URLSearchParams({ path })}`);
  if (!response.ok) throw new Error(`can't read ${path}`);
  return response.arrayBuffer();
}
