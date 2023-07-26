# Makefile

# Variables
DENO_PERMISSIONS=--allow-net --allow-read --allow-write --allow-env --allow-run --unstable
DOCKER_IMAGE_NAME=rungpt_actions:latest

# Main Deno app targets
.PHONY: build
build:
	deno compile $(DENO_PERMISSIONS) -o rungpt rungpt.ts

.PHONY: run
run:
	deno run $(DENO_PERMISSIONS) rungpt.ts

.PHONY: dev
dev:
	DEBUG=store:dispatch deno run $(DENO_PERMISSIONS) --watch rungpt.ts

.PHONY: inspect
inspect:
	deno run $(DENO_PERMISSIONS) --inspect rungpt.ts

# Actions Docker image targets
.PHONY: docker-build
docker-build:
	docker build -t $(DOCKER_IMAGE_NAME) -f docker/Dockerfile .

.PHONY: docker-clean
docker-clean:
	docker image rm $(DOCKER_IMAGE_NAME)

# Testing
.PHONY: test
test:
	deno test --allow-read --allow-run --allow-write --allow-env --unstable
