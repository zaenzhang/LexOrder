// Downloads a fixed upstream configuration; does NOT start or provision services.
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
const commit = 'db1cd5929a7885a3074547791f5ecc4d2f891739';
const files = {
  'docker/docker-compose.yml': '530a7832b1f99779604cd8f21e9e1c30c1025144',
  'docker/docker-compose-base.yml': '272a4127732a573fc391804972107e77a042cfc3',
  'docker/entrypoint.sh': 'f68495e9a66bc366323887703d53d9bc48e7fc8b',
  'docker/kvrocks-entrypoint.sh': '56353d45260dd9a9c5be07a340be7944ab6c7a4d',
  'docker/init.sql': '7a2e0da3596a43cf33ebe0701286b47982028029',
  'docker/service_conf.yaml.template': '55911ef09a39dd2e34cf3aaaabadd0e3076fadee',
  'docker/.env': '2e18fb8921ecde51fb4c89497f5817459b420490',
  'LICENSE': '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64',
};
const images = {
  'ragflow-cpu': 'infiniflow/ragflow:v1.0.0@sha256:ed8dff41a7530ed8fb037fe7479a7c535429d42fa8d00aec28b54bcbc056934d',
  es01: 'elasticsearch:8.11.3@sha256:58a3a280935d830215802322e9a0373faaacdfd646477aa7e718939c2f29292a',
  mysql: 'mysql:8.0.40@sha256:d58ac93387f644e4e040c636b8f50494e78e5afc27ca0a87348b2f577da2b7ff',
  minio: 'pgsty/silo:RELEASE.2026-08-06T00-00-00Z@sha256:29a498b24669cae1fed11c1a2fb2b3d73c68829a0a9c0b14e71b386671d38fac',
  kvrocks: 'apache/kvrocks:2.16.0@sha256:9e632c317c83c80d92f1c9d22ac6aa9f64d149e1f04ff2af5f15a5768a01c4b7',
  nats: 'nats:2.14.2@sha256:bbfbb6c4cdaeb8a2e3ca57d3de30463a66a6c5181f324f3b680bcf858833d377',
};
if (!process.argv[2]) throw new Error('Supply a NEW output directory. No services are started.');
const out = path.resolve(process.argv[2]);
await mkdir(path.dirname(out), { recursive: true });
await mkdir(out, { mode: 0o700 });
await mkdir(path.join(out, 'upstream'), { mode: 0o700 });
await mkdir(path.join(out, 'ragflow-logs'), { mode: 0o700 });
const downloaded = new Map();
const results = await Promise.allSettled(Object.entries(files).map(async ([name, expected]) => {
  const { stdout } = await promisify(execFile)('curl', ['-fLsS', '--max-time', '45', `https://raw.githubusercontent.com/infiniflow/ragflow/${commit}/${name}`], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 });
  const digest = createHash('sha1').update(Buffer.from(`blob ${stdout.length}\0`)).update(stdout).digest('hex');
  if (digest !== expected) throw new Error('Upstream integrity mismatch: ' + name);
  downloaded.set(name, stdout.toString('utf8'));
  await writeFile(path.join(out, 'upstream', path.basename(name)), stdout, { mode: 0o600 });
}));
const failures = results.filter(result => result.status === 'rejected');
if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Pinned source download failed');
const main = YAML.parse(downloaded.get('docker/docker-compose.yml'));
const base = YAML.parse(downloaded.get('docker/docker-compose-base.yml'));
const services = {};
for (const [name, image] of Object.entries(images)) {
  const service = structuredClone(main.services?.[name] ?? base.services?.[name]);
  if (!service) throw new Error('Missing pinned upstream service: ' + name);
  service.image = image;
  delete service.container_name; delete service.profiles;
  service.ports = name === 'ragflow-cpu' ? ['127.0.0.1:9380:9380', '127.0.0.1:9388:80'] : [];
  if (service.depends_on) service.depends_on = Object.fromEntries(Object.entries(service.depends_on).filter(([dependency]) => dependency in images));
  services[name] = service;
}
const compose = { name: 'lexorder-ragflow-m1', services, networks: base.networks, volumes: base.volumes };
// A single generated config avoids include/override port-merging surprises.
await writeFile(path.join(out, 'compose.yml'), YAML.stringify(compose), { mode: 0o600 });
const overrides = { DOC_ENGINE: 'elasticsearch', DB_TYPE: 'mysql', DEVICE: 'cpu', METADATA_DB_PROFILE: 'mysql',
  COMPOSE_PROFILES: 'elasticsearch,cpu,metadata-mysql', RAGFLOW_IMAGE: images['ragflow-cpu'], MYSQL_DBNAME: 'rag_flow',
  MYSQL_HOST: 'mysql', MYSQL_PORT: '3306', MINIO_HOST: 'minio', KVROCKS_HOST: 'kvrocks', KVROCKS_PORT: '6379',
  NATS_HOST: 'nats', NATS_PORT: '4222', REGISTER_ENABLED: '0', ENABLE_REGISTER: '0' };
for (const name of ['ELASTIC_PASSWORD', 'MYSQL_PASSWORD', 'MINIO_PASSWORD', 'REDIS_PASSWORD', 'ADMIN_DEFAULT_PASSWORD']) overrides[name] = randomBytes(24).toString('hex');
let environment = downloaded.get('docker/.env');
for (const [name, value] of Object.entries(overrides)) {
  const expression = new RegExp('^' + name + '=.*$', 'm');
  environment = expression.test(environment) ? environment.replace(expression, name + '=' + value) : environment + '\n' + name + '=' + value;
}
await writeFile(path.join(out, '.env'), environment, { mode: 0o600 });
const config = YAML.parse(downloaded.get('docker/service_conf.yaml.template'));
delete config.user_default_llm;
config.log = { ...config.log, level: 'warn' };
await writeFile(path.join(out, 'service_conf.yaml.template'), YAML.stringify(config), { mode: 0o600 });
for (const name of ['entrypoint.sh', 'kvrocks-entrypoint.sh', 'init.sql']) await writeFile(path.join(out, name), downloaded.get('docker/' + name), { mode: name.endsWith('.sh') ? 0o700 : 0o600 });
await writeFile(path.join(out, 'LICENSE'), downloaded.get('LICENSE'));
await writeFile(path.join(out, 'provenance.json'), JSON.stringify({ commit, images, files, status: 'PREPARED_NOT_DEPLOYED', modelConfiguration: 'REQUIRED', logs: 'warn_requires_live_verification' }, null, 2));
console.log(JSON.stringify({ status: 'PREPARED_NOT_DEPLOYED', directory: out, services: Object.keys(services),
  next: 'docker compose --project-name lexorder-ragflow-m1 --env-file .env -f compose.yml config --quiet' }));
