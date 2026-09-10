# Work Summary — ROS 2 Humble Docker Environment for Decentralized GNN-Based AMR Coordination

Date: 2026-09-11
Project: `/home/ksp/amr_fleet`

## 1. Goal

Create a runnable ROS 2 Humble environment, inside Docker, that simulates a **warehouse with 3 Autonomous Mobile Robots (AMRs) communicating with each other** — the first step of the Decentralized GNN-Based AMR Coordination System described in `README(1).md`.

The environment mirrors the project's target hardware architecture (3 separate boards on one Wi-Fi LAN) using **3 separate Docker containers on the host network** plus one container for warehouse visualization.

## 2. What was built

```
amr_fleet/
├── docker/
│   ├── Dockerfile              # ROS 2 Humble (Ubuntu 22.04/jammy) image
│   └── docker-compose.yml      # compose variant (optional, needs compose plugin)
├── run.sh                      # primary runner (no compose plugin required)
├── README.md                   # quick-run guide
├── README(1).md                # original project document
└── src/
    ├── amr_fleet_msgs/         # custom ROS 2 messages (package 1)
    │   ├── msg/RobotState.msg      # x, y, theta, vx, vy, omega, goal, obstacle_distance, timestamp
    │   ├── msg/NeighborStates.msg  # RobotState[] neighbors  (local GNN graph)
    │   ├── CMakeLists.txt
    │   └── package.xml
    └── amr_fleet/              # ROS 2 Python nodes (package 2)
        ├── scripts/robot_node.py      # AMR agent: motion + DDS comms + local GNN
        ├── scripts/warehouse_sim.py   # 20x20 grid visualizer + comm-graph printer
        ├── launch/warehouse_all.launch.py
        ├── setup.py / setup.cfg / package.xml
```

## 3. Architecture implemented

```
              DDS / ROS 2  (ROS_DOMAIN_ID=42, best_effort QoS)
    +----------------+-------------------+
    |                |                   |
  amr_robot1      amr_robot2         amr_robot3        <- own Docker container each
  (robot1)        (robot2)           (robot3)
    |                |                   |
    +--------+  amr_warehouse_sim  +----+                <- grid render + comm graph
             v         v           v
        warehouse 20x20 grid, racks (obstacles), spawns, goals
```

Decentralized model (README §10): each robot knows its own state, subscribes to the two other robots' `/robotN/state` topics, builds its **local communication graph** and runs its own message-passing GNN locally — no central planner.

### Topics per robot (all in the robot's namespace)

| Topic | Type | Meaning |
|---|---|---|
| `/robotN/state` | `amr_fleet_msgs/RobotState` | own pose + velocity + goal + obstacle distance (10 Hz) |
| `/robotN/neighbor_states` | `amr_fleet_msgs/NeighborStates` | local graph / GNN input (§9) |
| `/robotN/gnn_action` | `geometry_msgs/Twist` | GNN coordination output `[v, omega]` |

## 4. Simulation behaviour

- 20×20 warehouse grid with static obstacles (shelving racks), defined identically in every node
- Spawns from map markers: R1 top-left, R2 top-right, R3 mid-right
- Delivery goals: R1 → (17,13), R2 → (2,15), R3 → (3,2)
- Motion: go-to-goal with speed scaling near goal, inter-robot repulsion (decentralized coordination term, §9), and a **wall-follow state machine** for obstacle avoidance (fixed a deadlock/oscillation bug found during verification)
- GNN: minimal message-passing network `h_v = W2·ReLU(W1·[h_v ‖ mean_{u∈N(v)} h_u])` using torch-CPU with a numpy fallback; interface designed so the real research model can be dropped into `LocalGNN` (§9)

## 5. Infrastructure decisions & gotchas fixed

1. **`--network host`** on all containers → one shared multicast DDS domain, equivalent to the project's single-LAN Wi-Fi plan.
2. **`--ipc=host`** is REQUIRED — Fast DDS shared-memory transport silently fails across container IPC namespaces. Symptoms: `ros2 topic list` shows topics but no data arrives (`ros2 topic echo` empty, warehouse shows "offline"). Fixed after diagnosis.
3. **SELinux (Fedora, enforcing)** blocks bind-mount reads → added `:z` to `-v` mounts in `run.sh`.
4. **setuptools** gets upgraded by `pip install torch` and breaks the ROS `ament_cmake_python` message build (`canonicalize_version` error) → pinned `setuptools==59.6.0` in the Dockerfile.
5. **Map parser bug** — `R1/R2/R3` spawn markers were consumed character-by-character and goals landed on wall cells → replaced with regex-based tokenizer and validated all spawn/goal cells are free.
6. **Wall-follow deadlock** — naive PD turning oscillated forever against the first rack; robots froze. Replaced with a side-memory wall-follow state machine that only exits avoidance when the ray toward the goal is clear again.

## 6. Verification results

- Image builds cleanly; `colcon build` compiles both packages (`amr_fleet_msgs`, `amr_fleet`)
- All 4 containers come up and stay up (`amr_robot1/2/3`, `amr_warehouse_sim`)
- Cross-container `ros2 topic list` shows all `/robotN/*` topics
- Direct rclpy probes (bypassing flaky ros2cli graph introspection) confirmed:
  - `/robotN/state` delivered **10 Hz across containers**
  - neighbor graph aggregation (`/robot2/neighbor_states` = robot1, robot2, robot3 poses) works
  - `/robotN/gnn_action` publishes `[v, omega]` continuously
- Robots move through the warehouse, avoid racks, and **all three reach their goals** and stop:
  - R1: spawn (1.5, 18.5) → goal (17, 13) ✓
  - R2: spawn (17.5, 18.5) → goal (2, 15) ✓
  - R3: spawn (17.5, 10.5) → goal (3, 2) ✓
- Warehouse sim renders the grid with robot positions, goals (G) and the comm graph

## 7. How to run

```bash
cd /home/ksp/amr_fleet

./run.sh build   # once, builds image + compiles messages (few minutes)
./run.sh up      # start robot1/2/3 + warehouse sim
./run.sh comet   # watch the live grid
./run.sh logs    # follow robot1 logs  (or: ./run.sh logs amr_robot2)
```

Get inside a container and use ROS 2 interactively:

```bash
docker exec -it amr_robot1 /bin/bash
source /opt/ros/humble/setup.bash && source /amr_fleet_ws/install/setup.bash
ros2 topic list
ros2 topic echo /robot1/state --qos-reliability best_effort
```

Stop everything:

```bash
cd /home/ksp/amr_fleet && ./run.sh down
```

## 8. Current state (at time of writing)

All 4 containers are `Up` and the demo has been running continuously. Nothing further is needed to observe or extend the system.

## 9. Known limitations / next steps

- The GNN is a placeholder MPNN — swap in the research model in `LocalGNN` (src/amr_fleet/scripts/robot_node.py)
- Motion uses wall-follow, not global path planning; grid-based planner (JSON/A* ) can be added later
- `ros2` CLI graph commands (`ros2 topic echo` without `--qos-reliability best_effort`, `ros2 node info`) can be flaky against FastDDS in this multi-container setup — rclpy subscriptions work fine
- Jetson/JetPack-specific configuration and physical hardware deployment (README §13) are not addressed in this Docker stage