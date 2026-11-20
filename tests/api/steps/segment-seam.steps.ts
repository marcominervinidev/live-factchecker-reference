// Stage-3 steps for issue #27 (T2), AC13 (feature tests/api/features/segment-seam.feature): a request with any
// method to the edge. Extends the step library of edge.steps.ts (#25, frozen): it sets the World's `answer` in the
// shape that file's Then steps read ({ status, body, edgeMark }), so "the edge answers with status …" and "the answer
// was written by the edge itself …" apply unchanged. The HTTPS client is the shared support/edge-client.ts.
import { When, type World } from '@cucumber/cucumber';

import { sendToEdge, type EdgeAnswer } from './support/edge-client.ts';

interface EdgeWorld extends World {
  answer: EdgeAnswer | undefined;
}

When(
  'the client sends a {word} request to the edge for {string}',
  async function (this: EdgeWorld, method: string, path: string) {
    this.answer = await sendToEdge(method, path);
  },
);
