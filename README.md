# AMR Fleet — ROS 2 Humble Docker Environment

Dockerized **decentralized GNN-based AMR coordination** demo (see `README(1).md`): a
warehouse grid simulation with **3 AMRs**, each running in its own container and
communicating over ROS 2 DDS with `ROS_DOMAIN_ID=42`.

```
              DDS / ROS 2  (ROS_DOMAIN_ID=42)
    +----------------+-------------------+
    |                |                   |
  amr_robot1      amr_robot2         amr_robot3
  (robot1)        (robot2)           (robot3)
    |                |                   |
    +--------+  amr_warehouse_sim  +----+   (grid visualization)
             |         |           |
             v         v           v
        warehouse 20x20 grid, obstacles (shelving racks), goals
```

## Layout

| Path | Purpose |
|---|---|
| `docker/Dockerfile` | ROS 2 Humble (jammy) + numpy + torch-CPU + built workspace |
| `docker/docker-compose.yml` | Compose variant (needs the compose plugin) |
| `run.sh` | No-compose runner (build / up / logs / shell / down / comet) |
| `src/amr_fleet_msgs/` | Custom messages `RobotState`, `NeighborStates` (README §8) |
| `src/amr_fleet/` | `robot_node.py` (AMR agent), `warehouse_sim.py` (grid), launch file |

## Namespaces & topics

Each AMR runs in its own namespace and advertises (all `best_effort`, 10 Hz):

```
/<robot>/state            amr_fleet_msgs/RobotState       own pose+goal+obstacle distance
/<robot>/neighbor_states  amr_fleet_msgs/NeighborStates  local graph (GNN input, README §9)
/<robot>/gnn_action       geometry_msgs/Twist             coordination output [v, omega]
```

Robots subscribe to the two *other* `/robotN/state` topics, so each builds its own
communication graph and runs a lightweight message-passing GNN from its local view —
no central planner (README §10).

## Quick start

```bash
./run.sh build   # build image + compile custom messages
./run.sh up      # start robot1/2/3 + warehouse sim (host network + host IPC)
./run.sh comet   # follow the live warehouse grid
./run.sh logs    # follow robot1 logs (or: ./run.sh logs amr_robot2)
./run.sh shell   # interactive ROS 2 shell in the workspace image
./run.sh down    # stop everything
```

Inside a shell you can inspect the running system:

```bash
ros2 topic list            # all /robotN topics are shared across containers
ros2 topic echo /robot1/state --qos-reliability best_effort
```

## Notes

- `--network host` is used so the containers share one multicast DDS domain and
  match the real single-LAN Wi-Fi topology from the project doc.
- `--ipc host` is required for Fast DDS shared-memory transport to deliver data
  across container boundaries (a plain `ros2 topic list` still shows topics even
  when delivery is broken, so verify with `ros2 topic echo`).
- Source live at `/repo` in the containers; edit local files and `./run.sh up`
  again without rebuilding.
- The GNN is a minimal MPNN placeholder with a numpy fallback — swap `LocalGNN`
  in `src/amr_fleet/scripts/robot_node.py` for the research model (README §9).