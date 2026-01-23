import 'fastify';

export type ClerkAuthContext = {
  userId: string;
  orgId: string;
  orgRole: string | null;
  sessionId?: string | null;
  claims?: Record<string, unknown>;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ClerkAuthContext;
  }
}
