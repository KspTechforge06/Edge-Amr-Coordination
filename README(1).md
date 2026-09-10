# Decentralized GNN-Based AMR Coordination System

## 1. Project Overview

This project develops a **decentralized coordination and collision-avoidance system for Autonomous Mobile Robots (AMRs)** in a warehouse/grid environment.

The main idea is to replace or reduce dependence on a **centralized fleet manager/path planner** with a network in which individual robots communicate with neighboring robots and make local decisions.

A **Graph Neural Network (GNN)** is used to model the multi-robot system as a graph:

- **Nodes** = AMRs/robots
- **Edges** = communication, proximity, or interaction between robots
- **Node features** = robot state, goal, velocity, obstacle information, etc.
- **GNN output** = local navigation/coordination action

The project should eventually demonstrate that robots can coordinate without requiring a single central planning server and can remain functional under communication or robot failures.

---

## 2. Current Hardware

There are three computing boards:

| Board | Role |
|---|---|
| Jetson Nano 4 GB | Robot 1 / primary GNN inference hardware |
| Raspberry Pi 4 | Robot 2 |
| Raspberry Pi 4 | Robot 3 |

The boards are intended to represent **three individual AMR agents**.

### Network constraint

**Ethernet is not currently available.**

Therefore, the robots will communicate over **Wi-Fi**.

Preferred initial setup:

```text
                 Wi-Fi Router / Hotspot
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
     Jetson Nano      RPi 4 #1       RPi 4 #2
       Robot 1          Robot 2        Robot 3
```

A phone hotspot can be used for initial testing if a dedicated Wi-Fi router is unavailable.

---

## 3. Proposed Software Architecture

The intended stack is:

```text
                    AMR APPLICATION
                         |
                 GNN Coordination
                         |
                    ROS 2 Nodes
                         |
                   DDS Middleware
                         |
          +--------------+--------------+
          |              |              |
       Robot 1        Robot 2        Robot 3
       Jetson         RPi 4          RPi 4
```

ROS 2 is preferred over ROS 1 because ROS 2 uses DDS-based communication and does not require a traditional central ROS Master.

The architecture should remain as decentralized as practical.

---

## 4. ROS 2 Distribution and OS Plan

### Raspberry Pi 4 boards

Target:

```text
Ubuntu 22.04 64-bit
ROS 2 Humble
ARM64 / aarch64
```

### Jetson Nano 4 GB

The Jetson Nano belongs to the older NVIDIA JetPack 4.x software generation and should retain its compatible NVIDIA/CUDA environment.

Target approach:

```text
JetPack 4.x
Ubuntu 18.04 host
ROS 2 Humble through a compatible container/community-supported setup
```

Do **not** casually upgrade the Jetson Nano host to Ubuntu 22.04, because the Jetson Nano's NVIDIA software stack is tied to its supported JetPack generation.

The exact JetPack/container setup should be verified before implementation.

---

## 5. Network Architecture

All three boards must connect to the **same Wi-Fi LAN**.

Example addressing:

```text
Router:
192.168.1.1

Robot 1 / Jetson:
192.168.1.101

Robot 2 / RPi:
192.168.1.102

Robot 3 / RPi:
192.168.1.103
```

These are example addresses only. Actual addresses depend on the router/hotspot.

The first networking milestone is:

```text
Robot 1 <--> Robot 2
Robot 1 <--> Robot 3
Robot 2 <--> Robot 3
```

This should be verified with `ping` before debugging ROS.

All robots should use the same:

```text
ROS_DOMAIN_ID=42
```

or another common domain ID.

---

## 6. ROS 2 Communication Model

There is no requirement for a central ROS Master.

The robots should communicate through DDS.

Conceptually:

```text
                 DDS / ROS 2
        +------------+------------+
        |            |            |
        v            v            v
      Robot 1      Robot 2      Robot 3
```

Each robot publishes its local state and subscribes to relevant neighbor information.

---

## 7. Suggested ROS Namespace

Each robot should have its own namespace:

```text
/robot1
/robot2
/robot3
```

Example topics:

```text
/robot1/state
/robot1/pose
/robot1/odom
/robot1/scan
/robot1/goal
/robot1/neighbor_states
/robot1/gnn_input
/robot1/gnn_action

/robot2/state
/robot2/pose
/robot2/odom
/robot2/scan
/robot2/goal
/robot2/neighbor_states
/robot2/gnn_input
/robot2/gnn_action

/robot3/state
/robot3/pose
/robot3/odom
/robot3/scan
/robot3/goal
/robot3/neighbor_states
/robot3/gnn_input
/robot3/gnn_action
```

Exact topic/message design can be changed during implementation.

---

## 8. Robot State

A possible robot-state representation is:

```text
x
y
theta
vx
vy
omega
goal_x
goal_y
obstacle_distance
```

A custom ROS message can eventually contain fields such as:

```text
float32 x
float32 y
float32 theta
float32 vx
float32 vy
float32 omega
float32 goal_x
float32 goal_y
```

Sensor data such as LiDAR can be added later.

---

## 9. GNN Representation

For three robots:

```text
V = {R1, R2, R3}
```

If every robot can communicate with every other robot:

```text
A =
[ 0  1  1
  1  0  1
  1  1  0 ]
```

where `A` is the graph adjacency matrix.

Node features could be:

```text
X =
[
  state_R1
  state_R2
  state_R3
]
```

Each robot can construct its local graph using:

- its own state
- neighboring robot states
- obstacle information
- target/goal information
- communication/proximity relationships

The GNN then produces an action or coordination output.

For example:

```text
GNN input
    |
    +-- Robot state
    +-- Neighbor states
    +-- Obstacles
    +-- Goal
    |
    v
  GNN model
    |
    v
[v, omega]
```

where:

- `v` = linear velocity
- `omega` = angular velocity

The exact GNN architecture and input/output dimensions depend on the research paper/model being implemented.

---

## 10. Decentralized GNN Concept

The desired architecture is not:

```text
             CENTRAL SERVER
             /     |      \
           R1      R2      R3
```

Instead, the target architecture is closer to:

```text
       GNN 1           GNN 2           GNN 3
         |               |               |
        R1 <-----------> R2 <-----------> R3
         ^               ^               ^
         +---------------+---------------+
```

Each robot should be able to calculate its own local decision from locally available and communicated information.

A fully decentralized implementation would run a GNN inference node on each robot.

Because the Jetson Nano has NVIDIA GPU/CUDA capability while Raspberry Pi 4 does not, the first implementation may use the Jetson as the main GNN inference platform. However, if the research requirement is **fully decentralized inference**, the final system should investigate running an appropriately lightweight GNN model on all three boards.

---

## 11. Grid-Based Simulation

The project includes a **grid/matrix-based warehouse simulation**.

Example:

```text
####################
# R1       #       #
#          #       #
#     R2           #
#                  #
#          #    R3 #
####################
```

The simulation should model:

- warehouse/grid cells
- static obstacles
- robot positions
- robot goals
- robot movement
- neighboring robots
- collision conditions
- communication graph
- path planning
- GNN-based coordination

A grid representation is useful for early software validation before deploying to physical AMRs.

---

## 12. Simulation-to-Hardware Path

The intended development sequence is:

```text
Grid simulation
      |
      v
Robot state generation
      |
      v
ROS 2 topics
      |
      v
Multi-robot communication
      |
      v
GNN integration
      |
      v
Local action generation
      |
      v
AMR controller
      |
      v
Physical robot
```

The simulation should use the same ROS message/topic concepts as the physical system as much as possible.

This makes the transition from simulation to hardware easier.

---

## 13. Development Phases

### Phase 1 — Board setup

Configure:

- Jetson Nano
- Raspberry Pi 4 #1
- Raspberry Pi 4 #2

### Phase 2 — Wi-Fi

Connect all three boards to the same Wi-Fi network.

Verify:

```bash
ping <other-board-ip>
```

between every pair.

### Phase 3 — ROS 2

Install/configure ROS 2.

Verify:

```bash
ros2 --help
```

and basic ROS nodes.

### Phase 4 — ROS 2 multi-board test

Test a publisher on one board and subscriber on another.

Example:

```bash
ros2 run demo_nodes_cpp talker
```

and on another board:

```bash
ros2 topic echo /chatter
```

### Phase 5 — AMR state messages

Implement:

```text
/robot1/state
/robot2/state
/robot3/state
```

### Phase 6 — Neighbor communication

Each robot should receive the states required to construct its local graph.

### Phase 7 — Grid simulation

Implement:

- grid
- obstacles
- robots
- goals
- movement
- collision checking

### Phase 8 — GNN

Integrate the GNN model.

### Phase 9 — Decentralized inference

Run local GNN inference and local action selection.

### Phase 10 — Failure testing

Test:

- robot failure
- Wi-Fi disconnection
- packet loss
- communication delay
- stale neighbor data
- dynamic obstacles

### Phase 11 — Physical AMR deployment

Move the validated ROS/GNN system onto actual mobile robots.

---

## 14. Main Research Demonstration

The key comparison should eventually be:

### Centralized system

```text
Robot 1 \
Robot 2  ---> Central Planner ---> Commands
Robot 3 /
```

versus:

### Decentralized system

```text
Robot 1 <--> Robot 2
   ^             ^
   |             |
   +----> Robot 3
```

Metrics can include:

- collision rate
- task completion time
- path length
- navigation success rate
- communication latency
- packet loss tolerance
- computation/inference latency
- scalability with number of robots
- behavior when one robot/network link fails

This comparison is important because the project is not simply "put a GNN on three robots"; the research contribution is **decentralized multi-AMR coordination using graph-based robot interaction**.

---

## 15. Important Current Constraints

1. **No Ethernet currently available** — use Wi-Fi.
2. Jetson Nano 4 GB has an older NVIDIA/JetPack software stack.
3. Raspberry Pis can use Ubuntu 22.04 64-bit + ROS 2 Humble.
4. Jetson host OS should not be casually upgraded to Ubuntu 22.04.
5. ROS 2 DDS communication must work before implementing the GNN.
6. The GNN model/paper should be mapped carefully to the robot-state and graph representation rather than directly assuming a generic GNN.
7. The initial simulation should be grid-based to simplify debugging.
8. The final goal is decentralized coordination, not merely centralized GNN inference.

---

## 16. Immediate Next Steps

The recommended immediate sequence is:

```text
1. Identify exact Jetson JetPack version
2. Confirm OS/architecture on both Raspberry Pis
3. Connect all three boards to the same Wi-Fi
4. Find their IP addresses
5. Test ping between all boards
6. Install ROS 2 Humble on the Raspberry Pis
7. Configure ROS 2/DDS on the Jetson
8. Set common ROS_DOMAIN_ID
9. Test ROS 2 communication across boards
10. Create /robot1, /robot2, /robot3
11. Build the grid simulation
12. Integrate the GNN
```

Do not start with physical AMR control or GNN deployment until the basic multi-board ROS 2 communication is proven.
