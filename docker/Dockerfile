# Dockerfile
FROM denoland/deno:latest

WORKDIR /app

RUN mkdir -p /actions/index /actions/installed
COPY . .

RUN chmod u+x ./docker/action.sh

CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--unstable", "./docker/indexer.ts"]
HEALTHCHECK --interval=10s --timeout=2s CMD ["/app/docker/action.sh", "healthcheck"]
