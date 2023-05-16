# Dockerfile
FROM denoland/deno:latest

WORKDIR /app

RUN mkdir -p /shared
RUN apt-get update && apt-get install -y curl git jq wget sudo

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&\
    apt-get install -y nodejs

CMD ["sleep", "infinity"]
