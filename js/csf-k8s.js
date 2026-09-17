// CS Fundamentals · Infrastructure — "Kubernetes fundamentals". A breadth-first
// operator's model: what k8s is, the control-plane/node architecture, the core
// objects, the declarative reconciliation loop, scheduling/scaling/health, and the
// traps. Rendered in the app's Markdown dialect; backticks are escaped (\`) because
// the whole guide is a template literal.
export const CSF_K8S_GUIDE = `# Kubernetes fundamentals

Kubernetes (k8s) is a **container orchestrator**: you declare the desired state of your workloads, and a set of control loops works continuously to make reality match. The entire system is one idea repeated everywhere — *observe actual state, compare to desired, act to close the gap* — so once you see the reconciliation loop, the rest of the API falls into place. Skim in ~15 minutes; the *Traps* are where real outages come from.

## 1. Why it exists

Containers package an app + its deps into an image that runs the same everywhere. But in production you have *many* containers across *many* machines, and you need: restart-on-crash, spread across hosts, rolling updates, service discovery, autoscaling, and self-healing when a node dies. Doing that by hand doesn't scale. Kubernetes is the layer that does it declaratively — you describe *what* you want, not *how* to achieve it.

## 2. The architecture

Two planes: a **control plane** (the brain) and **worker nodes** (where your containers run).

\`\`\`
        CONTROL PLANE                          WORKER NODE (×N)
  ┌────────────────────────┐            ┌───────────────────────────┐
  │ kube-apiserver  ◄──────────kubectl  │ kubelet  (runs/《reports pods)│
  │   │        ▲            │            │ kube-proxy (service routing)│
  │   ▼        │            │            │ container runtime (containerd)│
  │ etcd (state store)      │            │  → your Pods / containers  │
  │ scheduler               │            └───────────────────────────┘
  │ controller-manager      │
  └────────────────────────┘
\`\`\`

- **kube-apiserver** — the single front door. *Everything* (kubectl, controllers, kubelets) talks only to the API server; it validates and writes to etcd. There is no side channel.
- **etcd** — the consistent key-value store holding the entire cluster state (desired *and* observed). Lose etcd, lose the cluster — back it up.
- **scheduler** — watches for Pods with no node assigned and picks a node based on resource requests, affinity, taints, etc.
- **controller-manager** — runs the control loops (Deployment, ReplicaSet, Node, Job… controllers) that drive reconciliation.
- **kubelet** — the node agent: starts the containers the API server assigned to it and reports their status back.
- **kube-proxy** — programs node networking so Service virtual IPs route to the right Pods.

## 3. The core objects (the ones you actually use)

- **Pod** — the smallest deployable unit: one or more tightly-coupled containers sharing a network namespace (one IP) and volumes. **You rarely create Pods directly** — a controller does, so they can be recreated.
- **ReplicaSet** — keeps *N* identical Pods running. Almost always managed *by* a Deployment, not used directly.
- **Deployment** — the workhorse for **stateless** apps: declares a Pod template + replica count, and gives you **rolling updates and rollback**. You edit the image tag; the Deployment rolls Pods over safely.
- **StatefulSet** — for **stateful** apps needing stable identity/storage (databases, Kafka): stable network names (\`pod-0\`, \`pod-1\`), ordered rollout, and a persistent volume per Pod.
- **DaemonSet** — one Pod on *every* node (log shippers, node agents).
- **Job / CronJob** — run-to-completion tasks / scheduled tasks.
- **Service** — a stable virtual IP + DNS name in front of a changing set of Pods (Pods are ephemeral; their IPs churn). Types:
  - \`ClusterIP\` (default) — reachable only inside the cluster.
  - \`NodePort\` — opens a port on every node.
  - \`LoadBalancer\` — provisions a cloud load balancer (external traffic).
- **Ingress** — L7 HTTP routing (host/path → Services), TLS termination, one entry point for many Services. Needs an ingress controller (nginx, etc.).
- **ConfigMap / Secret** — inject config / sensitive values as env vars or mounted files (Secrets are base64, *not* encrypted by default — enable encryption-at-rest).
- **Namespace** — a virtual cluster for isolation + scoping quotas/RBAC.
- **PersistentVolume (PV) / PersistentVolumeClaim (PVC)** — storage abstraction: a Pod claims storage (PVC), the cluster binds it to real disk (PV), often dynamically via a StorageClass.

## 4. The declarative model + reconciliation loop

You write **YAML manifests** describing desired state and \`kubectl apply\` them. From then on, a **controller** runs this loop forever:

\`\`\`
loop:
  desired = read spec from etcd (via API server)
  actual  = observe the world
  if actual != desired: take action to converge
\`\`\`

Kill a Pod and the ReplicaSet controller notices \`actual < desired\` and makes a new one. Drain a node and its Pods get rescheduled elsewhere. This **level-triggered, self-healing** design (react to *state*, not to *events*) is the whole philosophy — it's why k8s recovers from partial failures without anyone paging.

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  replicas: 3
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - name: web
          image: myapp:1.4.2
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits:   { cpu: "500m", memory: "256Mi" }
          readinessProbe: { httpGet: { path: /healthz, port: 8080 } }
\`\`\`

## 5. Scheduling, health, scaling

- **requests vs limits** — \`requests\` is what the scheduler reserves (and what bin-packing uses to place Pods); \`limits\` is the hard ceiling. Exceed a memory limit → the container is **OOM-killed**; exceed CPU → it's **throttled**. Requests vs limits also set the Pod's **QoS class** (Guaranteed / Burstable / BestEffort), which decides eviction order under node pressure.
- **Probes** — \`liveness\` (restart the container if it hangs), \`readiness\` (pull the Pod out of the Service until it can serve — critical during startup and rollouts), \`startup\` (grace period for slow boots before liveness kicks in).
- **Rollouts** — a Deployment update rolls Pods gradually (maxSurge/maxUnavailable), gated by readiness; \`kubectl rollout undo\` reverts.
- **Autoscaling** — **HPA** (Horizontal Pod Autoscaler) adds/removes Pod replicas on CPU/memory/custom metrics; **Cluster Autoscaler** adds/removes *nodes* when Pods can't be scheduled. (VPA tunes requests/limits.)
- **Placement control** — \`nodeSelector\`/**affinity** (attract Pods to nodes), **taints & tolerations** (repel Pods unless they tolerate the taint), **topology spread** (spread across zones).

## 6. The networking model (the rules)

1. Every Pod gets its **own cluster-wide IP**; Pods talk to each other directly without NAT.
2. A **Service** gives a stable virtual IP/DNS (\`svc.namespace.svc.cluster.local\`) in front of Pods, load-balancing across them.
3. **Ingress** (L7) or \`LoadBalancer\` Services (L4) expose things externally.
4. **NetworkPolicies** are the firewall — *without* one, all Pods can talk to all Pods (open by default).

## 7. kubectl — the verbs you'll live in

\`\`\`
kubectl apply -f app.yaml        # declaratively create/update
kubectl get pods -o wide         # list (─n <ns> to scope)
kubectl describe pod <p>         # events + why it's not scheduling
kubectl logs <p> [-c <c>] [-f]   # container logs
kubectl exec -it <p> -- sh       # shell into a container
kubectl rollout status/undo deploy/<d>
kubectl get events --sort-by=.lastTimestamp   # what just happened
\`\`\`
When something's broken, the order is almost always: \`get pods\` (status) → \`describe\` (events) → \`logs\`.

## 8. Traps — the outage checklist

- **CrashLoopBackOff** — the container keeps exiting; \`logs\` + \`describe\`. Usually a bad config, a missing dependency, or a failing command — not k8s itself.
- **Pod Pending** — nowhere to schedule it: insufficient CPU/memory requests cluster-wide, an unsatisfiable affinity, or an unbound PVC. \`describe\` shows the reason.
- **No readiness probe** — a rollout sends traffic to Pods that aren't ready yet → errors during every deploy. Always set readiness.
- **No resource requests** — the scheduler can't bin-pack and one greedy Pod starves neighbours; BestEffort Pods are evicted first.
- **liveness misused as readiness** — a slow-but-healthy app gets *restarted* in a loop. Liveness = "is it wedged?"; readiness = "should it get traffic?".
- **Secrets aren't secret** — base64, not encryption. Enable etcd encryption-at-rest and tighten RBAC.
- **latest tag** — \`image: app:latest\` makes rollouts non-deterministic and rollback meaningless. Pin an immutable tag/digest.
- **Treating Pods as pets** — Pods are cattle: ephemeral, replaceable, IPs churn. Never hardcode a Pod IP; go through a Service.
- **Open Pod-to-Pod network** — no NetworkPolicy means full lateral reachability. Default-deny, then allow.
- **etcd not backed up** — it *is* the cluster; a lost etcd with no snapshot is a lost cluster.

## 9. The one-paragraph version

"Kubernetes orchestrates containers declaratively: you post desired state (YAML) to the **API server**, which persists it in **etcd**, and **controllers** run reconciliation loops that continuously drive actual state toward desired — that level-triggered self-healing is the whole model. You almost never run bare **Pods**; a **Deployment** manages a ReplicaSet of stateless Pods with rolling updates and rollback (**StatefulSet** for stateful identity/storage). A **Service** gives a stable virtual IP over churning Pod IPs, and **Ingress** does L7 external routing. The **scheduler** places Pods by resource **requests**; **limits** cap them (OOM-kill / throttle); **readiness** probes gate traffic and rollouts, **liveness** restarts wedged containers; **HPA** scales replicas and the **cluster autoscaler** scales nodes. When it breaks: \`get pods → describe → logs\`, and watch for CrashLoopBackOff, Pending (unschedulable), and missing readiness probes."
`;
