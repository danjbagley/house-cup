# The House Cup — the single-page app plus a JSON state blob, served by server.js.
#
# Reproduces the image running in the cluster rather than inventing one: the
# pod reports Alpine 3.24.1, node v22.23.2, WORKDIR /app, uid 1000 (node),
# PID 1 = `node server.js`. The official node image does NOT default to the
# node user, so USER below is taken from the running container, not assumed.
#
# There is nothing to install: server.js uses only Node built-ins (http, fs,
# path), which is why there is no package.json and no npm install step.
#
# Build from the repo root:
#   docker build -t <REGISTRY>/house-cup:<TAG> .
#
# Use a NEW tag every build. Reusing 1.0.0 is how three different versions of
# this app ended up indistinguishable — see the baseline commit.

FROM node:22.23.2-alpine3.24

WORKDIR /app

# server.js already defaults to these; setting them means `docker run` needs
# no flags. The k8s deployment sets the same two values in its own env.
ENV PORT=8080 \
    DATA_DIR=/data

COPY app/server.js ./server.js
COPY app/public ./public

# Only takes effect when /data is not a mounted volume. Under k8s the PVC's
# own ownership wins, which is why the node currently needs the hostpath dir
# to be world-writable (RUNBOOK-CLUSTER.md §4, the EACCES note). The cleaner
# fix there is fsGroup on the pod, not a chmod on the node.
RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 8080

# Not in the deployed image; the k8s probes already cover the cluster case.
# Added so a plain `docker run` reports health too. busybox wget, no extra pkg.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
