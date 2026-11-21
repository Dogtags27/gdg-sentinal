# infra/

Owner: Hriday. Only Hriday deploys.

## Keys and buckets (H-03)

These need a human with the accounts. Do them once, before kickoff:

1. **Gemini key.** Create an API key in Google AI Studio on a project with billing enabled. Free-tier embedding limits are far too low for ~62k tickets in a few hours. Put it in `GEMINI_API_KEY`. Copy the current Gemini Flash model id into `GEN_MODEL`.
2. **R2 bucket.** In Cloudflare, create the bucket `sentineldesk-artifacts` and one API token with Object Read and Write on that bucket only. Put the S3 endpoint, key id and secret in the `R2_*` variables.
3. **Share the keys.** Copy `infra/env.template` to `.env` in the repo root, fill it in, and send it to the team privately (never in git, never in the repo chat history).
4. **Check access.** Each Python dev runs this from the repo root:

   ```
   pip install boto3 redis google-genai
   python infra/check_access.py
   ```

   It prints OK, SKIP or FAIL for Gemini, R2 and Redis, and never prints a secret.

## Local Redis (H-04)

Redis with the Query Engine (vector search), plus RedisInsight for debugging. Start Docker Desktop and create `.env` (step 3 above) first, then from the repo root:

```
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d
docker compose --env-file .env -f infra/docker-compose.dev.yml ps      # wait for "healthy"
python infra/check_access.py                                           # Redis line should say OK
```

- Redis: `localhost:6379`. The password is `REDIS_PASSWORD`, and the port is bound to localhost only.
- RedisInsight: http://localhost:8001. Add a database at `localhost:6379` with the same password.
- Data survives restarts in the `redis-data` volume. To start over: `docker compose --env-file .env -f infra/docker-compose.dev.yml down -v`.

The image is pinned (`redis/redis-stack:7.4.0-v8`) so every laptop and EC2 run the same Redis. On EC2, port 6379 is never opened in the security group.
