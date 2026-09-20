// Guruji API — placeholder handler. Enough to prove the wiring end to end
// (API Gateway HTTP API → Lambda → DynamoDB) and to be replaced with the real
// server-authoritative CRUD (/state, /items/:id, /log, /pipeline, /settings).
//
// Runtime: nodejs20.x. The AWS SDK v3 is available in the runtime, so no bundler
// is needed yet — matches the app's zero-build philosophy.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || 'GET';
  const path = event?.rawPath || '/';

  // Public health check (no auth) — used by CI/smoke tests.
  if (method === 'GET' && path === '/health') {
    return json(200, { ok: true, service: 'guruji-api', env: process.env.ENV || 'dev', time: new Date().toISOString() });
  }

  // The Cognito JWT authorizer has already validated the token for guarded
  // routes; the user id is the token `sub`.
  const sub = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!sub) return json(401, { error: 'unauthenticated' });

  // GET /state — bootstrap: one query returns everything for this user.
  if (method === 'GET' && path === '/state') {
    try {
      const res = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${sub}` },
      }));
      return json(200, { items: res.Items || [] });
    } catch (err) {
      return json(500, { error: 'query_failed', detail: String(err?.message || err) });
    }
  }

  // TODO: PUT /items/:id, POST /log, PUT /settings, PUT /pipeline/:id, with
  // If-Match / version optimistic concurrency.
  return json(404, { error: 'not_found', method, path });
};
