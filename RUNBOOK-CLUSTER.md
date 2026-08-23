# House Cup — statisticalnetworks cluster addendum

This replaces sections 1, 2, 3 and 6 of the generic RUNBOOK.md for the
MicroK8s cluster (devious / pepper / macpro). Everything in sections 4, 5,
7 and 8 of the original (verify checklist, migration, invariants, rollback)
stands unchanged and is the part worth keeping verbatim.

## 1. Build & push (replaces generic §1)

Build on devious — it already runs Docker CE alongside MicroK8s:

    docker build -t <REGISTRY>/house-cup:1.0.0 .
    docker push <REGISTRY>/house-cup:1.0.0

`<REGISTRY>` decision needed: GitLab's container registry (if enabled in
the Helm values), Nexus's docker-hosted repo, or Artifactory. Whichever
you pick, if it requires auth for pulls, create `house-cup-regcred` in the
house-cup namespace out-of-band (bootstrap/secrets.sh) and uncomment
`imagePullSecrets` in deployment.yaml. Tag bumps go in Git — edit the
image tag in `house-cup/manifests/deployment.yaml`, commit, let ArgoCD
roll it. Never `kubectl set image`.

Drop the k3s/kind lines from the generic runbook — not applicable.

## 2. Deploy (replaces generic §2 — GitOps, not kubectl apply)

    # in the tooling repo
    git add house-cup/
    git commit -m "house-cup: initial deploy"
    git push

    # one-time, until the root app-of-apps exists (known gotcha —
    # Application definitions are NOT picked up from Git yet):
    kubectl apply -f house-cup/apps/house-cup.yaml

    argocd app sync house-cup --grpc-web
    kubectl -n house-cup rollout status deploy/house-cup

Before first sync (out-of-band secrets, same pattern as minio-root-creds):

    # MinIO creds for the backup CronJob:
    kubectl get secret minio-root-creds -n minio -o yaml \
      | sed 's/namespace: minio/namespace: house-cup/' | kubectl apply -f -

## 3. Expose (replaces generic §3)

The team uses this from phones off the home network, so the choice is:

- **Option A — existing ingress + cert-manager.** Manifest is pre-wired
  for `housecup.statisticalnetworks.com`. Requires: public DNS A record →
  the DrayTek WAN1 static IP, and 443 forwarded on the Vigor 2927 to the
  ingress-nginx LoadBalancer IP (MetalLB). If ArgoCD at
  argocd.statisticalnetworks.com is already internet-reachable this is
  just one DNS record; if it's LAN-only, you're opening 443 for the first
  time — decide deliberately.
- **Option B — Cloudflare Tunnel.** No open ports on the Vigor. Run
  `cloudflared` in-cluster pointing a hostname at
  `http://house-cup.house-cup.svc:80`; delete/ignore the Ingress (comment
  it out of kustomization.yaml rather than leaving it half-applied).
  Tunnel token = out-of-band secret, bootstrap/secrets.sh.

Trust-model note: the courtesy lock means anyone who can reach the URL
can PUT state. That was fine on a LAN/artifact; on the public internet
the mitigations are the obscure hostname, the in-app Undo, and the
nightly MinIO backups below. If that ever feels thin, server-side auth
on PUT is the deliberate project the original runbook describes.

## 4. Verify — cluster-specific additions to generic §4

Run the original checklist, plus:

    # the body-size fix actually took (should show 6m):
    kubectl -n house-cup get ingress house-cup \
      -o jsonpath='{.metadata.annotations.nginx\.ingress\.kubernetes\.io/proxy-body-size}'

    # PV landed where expected (devious) and pod followed:
    kubectl get pv -o wide | grep house-cup
    kubectl -n house-cup get pod -o wide

    # if the pod CrashLoops with EACCES on /data: the hostpath dir on the
    # node needs a chmod (same class of issue as the DSM zero-perms share)

    # backup path works end-to-end without waiting for 03:15:
    kubectl -n house-cup create job --from=cronjob/house-cup-backup backup-test
    kubectl -n house-cup logs job/backup-test
    # then check the object exists via the MinIO console

## 6. Backups (replaces generic §6)

The CronJob in `manifests/backup-cronjob.yaml` copies `/data/state.json`
nightly (03:15) into the `house-cup-backups` bucket in MinIO. MinIO's
persistence is on `nfs-synology`, so every backup physically lands on the
DS218+ with zero manual habit — and inherits the 3-2-1 story when the
DXP2800/DS218j architecture lands. The in-app Cup → Backup remains the
human-friendly restore format; both produce the same JSON.

Restore path: download the object from MinIO console → sign in as Danny →
Cup → Restore → paste → Confirm.

## Ops notes

- `replicas: 1` + `Recreate` + RWO is correct and load-bearing. If anyone
  (including future-you) sees the single replica and reaches for an HPA,
  the Architecture section of the original runbook explains why not.
- Backlog item 5 (resource requests on heavy pods): this app already
  ships requests/limits — nothing to do.
- Snap auto-refresh restarts kubelite (see 14 Aug pepper incident); the
  pod will Recreate cleanly, the poll-based clients just reconnect. No
  special handling needed, but a node NotReady >5m alert (backlog item 8)
  covers the case where the board's node is the one that goes down.
