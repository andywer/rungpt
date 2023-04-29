# Dockerfile
FROM denoland/deno:latest

WORKDIR /app

RUN apt-get update && apt-get install -y curl git wget

RUN mkdir -p /actions/index /actions/installed
COPY . .

RUN chmod u+x ./docker/action.sh

CMD ["sleep", "infinity"]
