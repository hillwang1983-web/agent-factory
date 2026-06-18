# Agent Factory Quick Start

## 1. Install Dependencies

```bash
cd agent-factory-dashboard/backend
npm install

cd ../frontend
npm install
```

## 2. Configure Backend

```bash
cd agent-factory-dashboard/backend
cp .env.example .env
```

Edit `.env` and set:

- `AGENT_FACTORY_WORKSPACE`
- `AGENT_FACTORY_ALLOWED_PROJECT_ROOTS`
- `HERMES_CONFIG_PATH`

## 3. Bootstrap Runtime Registry

```bash
cd agent-factory-dashboard/backend
npm run bootstrap
```

## 4. Run Doctor

```bash
npm run doctor -- --skip-hermes
```

Remove `--skip-hermes` after Hermes is installed and configured.

## 5. Start Backend

```bash
AGENT_FACTORY_ENABLE_CONTROL=true npm run dev
```

## 6. Start Frontend

```bash
cd ../frontend
cp .env.example .env
npm run dev
```

Open `http://localhost:5175`.
