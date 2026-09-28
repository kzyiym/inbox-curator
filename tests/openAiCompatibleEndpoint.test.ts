import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNodeOpenAiCompatibleTransport,
  detectOpenAiTokenLimitParam,
  openAiCompatibleEndpointError,
  postOpenAiCompatibleChat,
  setOpenAiCompatibleTransport,
  validateOpenAiCompatibleEndpoint,
  type OpenAiCompatibleEndpointErrorReason,
  type OpenAiCompatibleTransport,
} from '../src/openAiCompatible';
import { testConnection } from '../src/connectionTest';
import { t } from '../src/i18n';
import { updateEndpointWarningElement } from '../src/settings';

afterEach(() => {
  setOpenAiCompatibleTransport(undefined);
});

describe('validateOpenAiCompatibleEndpoint', () => {
  it.each([
    ['https://api.openai.com/v1', false],
    ['https://localhost:8443/v1', false],
    ['https://[::1]:8443/v1', false],
    ['http://localhost:11434/v1', true],
    ['http://localhost/v1', true],
    ['http://127.0.0.1:11434/v1', true],
    ['http://127.5.6.7:11434/v1', true],
    ['http://127.1/v1', true],
    ['http://2130706433/v1', true],
    ['http://[::1]:11434/v1', true],
    ['http://[0:0:0:0:0:0:0:1]:11434/v1', true],
  ])('allows %s with isLocalHttp=%s', (endpointUrl, isLocalHttp) => {
    const result = validateOpenAiCompatibleEndpoint(endpointUrl);
    expect(result.ok).toBe(true);
    expect(result.isLocalHttp).toBe(isLocalHttp);
  });

  it.each([
    ['http://api.openai.com/v1', 'insecure-remote-http'],
    ['http://example.com/v1', 'insecure-remote-http'],
    ['http://foo.localhost:11434/v1', 'insecure-remote-http'],
    ['http://localhost.:11434/v1', 'insecure-remote-http'],
    ['http://0.0.0.0:11434/v1', 'insecure-remote-http'],
    ['ftp://example.com/v1', 'unsupported-scheme'],
    ['file:///etc/passwd', 'unsupported-scheme'],
    ['https://user:pass@api.openai.com/v1', 'credentials-in-url'],
    ['http://user:pass@127.0.0.1:11434/v1', 'credentials-in-url'],
    ['not a url', 'invalid'],
    ['   ', 'invalid'],
  ])('rejects %s as %s', (endpointUrl, reason) => {
    const result = validateOpenAiCompatibleEndpoint(endpointUrl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(reason as OpenAiCompatibleEndpointErrorReason);
    }
  });
});

function recordingTransport(response: { status: number; text: string }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const transport: OpenAiCompatibleTransport = async (request) => {
    calls.push({ url: request.url, headers: request.headers, body: request.body });
    return response;
  };
  return { transport, calls };
}

const baseRequest = {
  model: 'gpt-4o-mini',
  apiKey: 'test-key-not-a-secret',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('postOpenAiCompatibleChat endpoint enforcement', () => {
  it('blocks a remote HTTP endpoint without invoking the transport', async () => {
    const { transport, calls } = recordingTransport({ status: 200, text: '{}' });
    setOpenAiCompatibleTransport(transport);

    const result = await postOpenAiCompatibleChat({ ...baseRequest, endpointUrl: 'http://api.example.com/v1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(openAiCompatibleEndpointError('insecure-remote-http'));
    }
    expect(calls).toHaveLength(0);
  });

  it('blocks credentials embedded in the endpoint URL', async () => {
    const { transport, calls } = recordingTransport({ status: 200, text: '{}' });
    setOpenAiCompatibleTransport(transport);

    const result = await postOpenAiCompatibleChat({ ...baseRequest, endpointUrl: 'https://user:pass@api.example.com/v1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(openAiCompatibleEndpointError('credentials-in-url'));
    }
    expect(calls).toHaveLength(0);
  });

  it('allows a loopback HTTP endpoint and sends a Bearer request through the transport', async () => {
    const { transport, calls } = recordingTransport({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    });
    setOpenAiCompatibleTransport(transport);

    const result = await postOpenAiCompatibleChat({ ...baseRequest, endpointUrl: 'http://127.0.0.1:11434/v1' });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${baseRequest.apiKey}`);
  });

  it('allows a remote HTTPS endpoint and sends the request', async () => {
    const { transport, calls } = recordingTransport({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    });
    setOpenAiCompatibleTransport(transport);

    const result = await postOpenAiCompatibleChat({ ...baseRequest, endpointUrl: 'https://api.example.com/v1' });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('detectOpenAiTokenLimitParam endpoint enforcement', () => {
  it('does not send capability probes to a remote HTTP endpoint', async () => {
    const { transport, calls } = recordingTransport({ status: 200, text: '{}' });
    setOpenAiCompatibleTransport(transport);

    const detected = await detectOpenAiTokenLimitParam('http://api.example.com/v1', 'gpt-4o-mini', baseRequest.apiKey);

    expect(detected).toBe('unknown');
    expect(calls).toHaveLength(0);
  });
});

describe('testConnection endpoint enforcement', () => {
  it('blocks a remote HTTP openai-compatible endpoint without invoking the transport', async () => {
    const { transport, calls } = recordingTransport({ status: 200, text: '{}' });
    setOpenAiCompatibleTransport(transport);

    const result = await testConnection({
      provider: 'openai-compatible',
      endpointUrl: 'http://api.example.com/v1',
      model: 'gpt-4o-mini',
      apiKey: baseRequest.apiKey,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(openAiCompatibleEndpointError('insecure-remote-http'));
    }
    expect(calls).toHaveLength(0);
  });
});

interface RecordedRequest {
  headers: IncomingHttpHeaders;
  body: string;
}

interface TestServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

function attachRecorder(
  server: http.Server | https.Server,
  requests: RecordedRequest[],
  handler: (request: http.IncomingMessage, response: http.ServerResponse, body: string) => void,
): void {
  server.on('request', (request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ headers: request.headers, body });
      handler(request, response, body);
    });
    request.on('error', () => {});
    response.on('error', () => {});
  });
}

function startHttpServer(handler: (request: http.IncomingMessage, response: http.ServerResponse, body: string) => void): Promise<TestServer> {
  return new Promise((resolve) => {
    const requests: RecordedRequest[] = [];
    const server = http.createServer();
    attachRecorder(server, requests, handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

function startHttpsServer(
  tls: { key: string; cert: string },
  handler: (request: http.IncomingMessage, response: http.ServerResponse, body: string) => void,
): Promise<TestServer> {
  return new Promise((resolve) => {
    const requests: RecordedRequest[] = [];
    const server = https.createServer({ key: tls.key, cert: tls.cert });
    attachRecorder(server, requests, handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `https://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            (server as https.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

const realLoader = <T>(name: string): T | undefined => {
  if (name === 'node:http' || name === 'http') return http as unknown as T;
  if (name === 'node:https' || name === 'https') return https as unknown as T;
  if (name === 'node:zlib' || name === 'zlib') return zlib as unknown as T;
  return undefined;
};

function jsonHandler(content: string) {
  return (_request: http.IncomingMessage, response: http.ServerResponse) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  };
}

function redirectHandler(targetUrl: string, status = 302) {
  return (_request: http.IncomingMessage, response: http.ServerResponse) => {
    response.writeHead(status, { Location: `${targetUrl}/chat/completions` });
    response.end('redirect-body-must-not-be-forwarded');
  };
}

describe('redirect bypass prevention (real local servers)', () => {
  it.each([301, 302, 303, 307, 308])('does not follow a %i chat redirect and leaks nothing to the redirect target', async (status) => {
    const target = await startHttpServer(jsonHandler('LEAKED'));
    const origin = await startHttpServer(redirectHandler(target.url, status));
    try {
      setOpenAiCompatibleTransport(createNodeOpenAiCompatibleTransport(realLoader));

      const result = await postOpenAiCompatibleChat({
        ...baseRequest,
        endpointUrl: `${origin.url}/v1`,
      });

      expect(result.ok).toBe(false);
      expect(origin.requests).toHaveLength(1);
      expect(origin.requests[0].headers.authorization).toBe(`Bearer ${baseRequest.apiKey}`);
      expect(target.requests).toHaveLength(0);
    } finally {
      await origin.close();
      await target.close();
    }
  });

  it('does not follow a capability-probe redirect and leaks nothing to the redirect target', async () => {
    const target = await startHttpServer(jsonHandler('LEAKED'));
    const origin = await startHttpServer(redirectHandler(target.url));
    try {
      setOpenAiCompatibleTransport(createNodeOpenAiCompatibleTransport(realLoader));

      const detected = await detectOpenAiTokenLimitParam(`${origin.url}/v1`, 'gpt-4o-mini', baseRequest.apiKey, 2000);

      expect(detected).toBe('unknown');
      expect(origin.requests.length).toBeGreaterThan(0);
      expect(origin.requests[0].headers.authorization).toBe(`Bearer ${baseRequest.apiKey}`);
      expect(target.requests).toHaveLength(0);
    } finally {
      await origin.close();
      await target.close();
    }
  });

  it('still allows a deliberate loopback HTTP endpoint with a 2xx JSON response', async () => {
    const server = await startHttpServer(jsonHandler('OK from local'));
    try {
      setOpenAiCompatibleTransport(createNodeOpenAiCompatibleTransport(realLoader));

      const result = await postOpenAiCompatibleChat({
        ...baseRequest,
        endpointUrl: `${server.url}/v1`,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toBe('OK from local');
      }
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('preserves non-2xx status and body parsing through the transport', async () => {
    const server = await startHttpServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'bad key' } }));
    });
    try {
      setOpenAiCompatibleTransport(createNodeOpenAiCompatibleTransport(realLoader));

      const result = await postOpenAiCompatibleChat({
        ...baseRequest,
        endpointUrl: `${server.url}/v1`,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.error).toBe('HTTP 401');
        expect(result.responseBody).toContain('bad key');
      }
    } finally {
      await server.close();
    }
  });
});

function generateSelfSignedCert(): { key: string; cert: string } | undefined {
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'kaz7-tls-'));
    const keyPath = path.join(dir, 'key.pem');
    const certPath = path.join(dir, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { stdio: 'ignore' });
    const key = readFileSync(keyPath, 'utf8');
    const cert = readFileSync(certPath, 'utf8');
    rmSync(dir, { recursive: true, force: true });
    return { key, cert };
  } catch {
    return undefined;
  }
}

const tlsFixture = generateSelfSignedCert();

const tlsLoader = <T>(name: string): T | undefined => {
  if (name === 'node:https' || name === 'https') {
    return {
      request: (options: Record<string, unknown>, callback: (response: unknown) => void) =>
        https.request({ ...options, rejectUnauthorized: false }, callback),
    } as unknown as T;
  }
  return realLoader<T>(name);
};

describe('endpoint warning UI element', () => {
  it('updates immediately on change, shows remote/local warnings, and hides for valid HTTPS', () => {
    const element = document.createElement('div');

    updateEndpointWarningElement(element, 'https://api.openai.com/v1');
    expect(element.style.display).toBe('none');
    expect(element.textContent).toBe('');

    updateEndpointWarningElement(element, 'http://127.0.0.1:11434/v1');
    expect(element.style.display).not.toBe('none');
    expect(element.textContent).toBe(t('settings.endpointUrl.warning.localHttp'));

    updateEndpointWarningElement(element, 'http://api.example.com/v1');
    expect(element.style.display).not.toBe('none');
    expect(element.textContent).toBe(t('settings.endpointUrl.warning.insecureRemoteHttp'));

    updateEndpointWarningElement(element, 'https://user:pass@api.example.com/v1');
    expect(element.textContent).toBe(t('settings.endpointUrl.warning.credentialsInUrl'));

    updateEndpointWarningElement(element, 'not a url');
    expect(element.textContent).toBe(t('settings.endpointUrl.warning.invalid'));

    updateEndpointWarningElement(element, 'https://api.openai.com/v1');
    expect(element.style.display).toBe('none');
    expect(element.textContent).toBe('');
  });

  it('ignores a missing element without throwing', () => {
    expect(() => updateEndpointWarningElement(undefined, 'http://api.example.com/v1')).not.toThrow();
  });
});

describe.skipIf(!tlsFixture)('HTTPS downgrade redirect prevention (real local TLS server)', () => {
  it('rejects an HTTPS-to-HTTP redirect on the chat path without contacting the target', async () => {
    const target = await startHttpServer(jsonHandler('LEAKED'));
    const origin = await startHttpsServer(tlsFixture!, redirectHandler(target.url));
    try {
      setOpenAiCompatibleTransport(createNodeOpenAiCompatibleTransport(tlsLoader));

      const result = await postOpenAiCompatibleChat({
        ...baseRequest,
        endpointUrl: `${origin.url}/v1`,
      });

      expect(result.ok).toBe(false);
      expect(origin.requests).toHaveLength(1);
      expect(origin.requests[0].headers.authorization).toBe(`Bearer ${baseRequest.apiKey}`);
      expect(target.requests).toHaveLength(0);
    } finally {
      await origin.close();
      await target.close();
    }
  });

  it('rejects an HTTPS-to-HTTP redirect on the capability path without contacting the target', async () => {
    const target = await startHttpServer(jsonHandler('LEAKED'));
    const origin = await startHttpsServer(tlsFixture!, redirectHandler(target.url));
    try {
      setOpenAiCompatibleTransport(createNodeOpenAiCompatibleTransport(tlsLoader));

      const detected = await detectOpenAiTokenLimitParam(`${origin.url}/v1`, 'gpt-4o-mini', baseRequest.apiKey, 2000);

      expect(detected).toBe('unknown');
      expect(origin.requests.length).toBeGreaterThan(0);
      expect(target.requests).toHaveLength(0);
    } finally {
      await origin.close();
      await target.close();
    }
  });
});
