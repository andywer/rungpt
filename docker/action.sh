#!/bin/sh

INDEX_DIR="/actions/index"
HEARTBEAT_FILE="$INDEX_DIR/.heartbeat"

if [ -z "$1" ]; then
    echo "Usage: $0 list|run|show [action]"
    exit 2
fi

if [ ! -f "$HEARTBEAT_FILE" ]; then
    attempt=0

    while [ ! -f "$HEARTBEAT_FILE" ]; do
        sleep 0.1
        attempt=$((attempt + 1))
        if [ $attempt -gt 10 ]; then
            echo "Error: No heartbeat file present, even after waiting. Indexer seems to have never run." 1>&2
            exit 1
        fi
    done
fi

if [ "$1" = "healthcheck" ]; then
    # Get the current Unix timestamp (in seconds)
    current_time=$(date +%s)

    # Get the file's last modified Unix timestamp (in seconds)
    file_modified_time=$(stat -c %Y "$HEARTBEAT_FILE")

    # Calculate the time difference (in seconds)
    time_difference=$((current_time - file_modified_time))

    if [ $time_difference -le 30 ]; then
        echo "Healthy"
        exit 0
    else
        echo "Heartbeat expired" 1>&2
        exit 1
    fi
fi

if [ "$1" = "deps" ]; then
    for action in $(ls -1 "$INDEX_DIR"); do
        if [ -f "$INDEX_DIR/$action/setup" ]; then
            if [ ! -f "$INDEX_DIR/$action/.setupdone" ]; then
                echo "Running setup for action '$action'"
                "$INDEX_DIR/$action/.setup" 0<&0 1>&1 2>&2
                code=$?

                if [ $code -eq 0 ]; then
                    touch "$INDEX_DIR/$action/.setupdone"
                    echo "Setup for action '$action' completed successfully"
                else
                    echo "Setup for action '$action' failed with exit code $code" 1>&2
                    exit 1
                fi
            fi
        fi
    done
elif [ "$1" = "list" ]; then
    for action in $(ls -1 "$INDEX_DIR"); do
        echo "$action"
    done
    exit 0
elif [ "$1" = "invoke" ]; then
    action="$2"
    shift
    shift
    "$INDEX_DIR/$action/run" "$@" 0<&0 1>&1 2>&2
    exit $?
elif [ "$1" = "show" ]; then
    cat "$INDEX_DIR/$2/manifest.json"
    exit $?
else
    echo "Unknown command: $1" 1>&2
    exit 1
fi
