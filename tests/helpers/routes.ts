import type { INestApplication } from '@nestjs/common';

// The routes the running app really answers, read from its router, so tests
// that are "generated from the route list" (#79, #82) cover a new route the
// moment it exists, without anyone remembering to add it.

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  // As registered: "/api/admin/bookings/:id"
  path: string;
}

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

export function listRoutes(app: INestApplication): Route[] {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack: Layer[] };
    _router?: { stack: Layer[] };
  };
  const stack = (instance.router ?? instance._router)?.stack ?? [];
  const found = new Map<string, Route>();
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      const upper = method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) continue;
      const route = {
        method: upper as Route['method'],
        path: layer.route.path,
      };
      found.set(`${route.method} ${route.path}`, route);
    }
  }
  return [...found.values()].sort((a, b) =>
    `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
  );
}

const SAMPLES: Record<string, string> = {
  id: '00000000-0000-0000-0000-000000000000',
  slot: 'hero',
  reference: 'BK-000001',
  token: 'x'.repeat(43),
  file: `${'a'.repeat(64)}.webp`,
  key: `${'a'.repeat(64)}.webp`,
};

// A request path for a route: ":id" becomes a real-looking id, and so on
export function concretePath(path: string): string {
  return path.replace(
    /:(\w+)/g,
    (_match, name: string) => SAMPLES[name] ?? 'x',
  );
}

// A route with its parameter names removed, to compare with the API doc, which
// names a parameter slightly differently in places (":key" and ":file")
export function shape(route: Route): string {
  return `${route.method} ${route.path.replace(/:\w+/g, ':param')}`;
}

export const isAdminRoute = (route: Route) =>
  route.path === '/api/admin' || route.path.startsWith('/api/admin/');

export const isMutation = (route: Route) => route.method !== 'GET';
