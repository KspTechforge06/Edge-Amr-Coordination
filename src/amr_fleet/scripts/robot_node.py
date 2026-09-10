#!/usr/bin/env python3
"""AMR robot node.

Simulates a single Autonomous Mobile Robot performing goal-navigation on a
shared warehouse grid, publishes its pose/velocity state via ROS 2 DDS, and
listens to the other two robots to build each robot's local communication
graph (adjacency + node features) for the decentralized GNN coordination
(README sections 5, 8, 9).

Topics published (in namespace /<robot_id>):
  <ns>/state            amr_fleet_msgs/RobotState   (own state at 10 Hz)
  <ns>/neighbor_states  amr_fleet_msgs/NeighborStates (local graph)
  <ns>/gnn_action       geometry_msgs/Twist  (coordination output [v, omega])

Topics subscribed:
  /robot1/state, /robot2/state, /robot3/state
"""

import argparse
import math
import os
import re
import sys
from datetime import datetime, timezone

import numpy as np

import rclpy
from rclpy.node import Node
from rclpy.qos import HistoryPolicy, QoSProfile, ReliabilityPolicy

from amr_fleet_msgs.msg import NeighborStates, RobotState
from geometry_msgs.msg import Twist

# ---------------------------------------------------------------------------
# Shared warehouse model (identical across all nodes, mirrors the physical map)
# ---------------------------------------------------------------------------

GRID_W = 20
GRID_H = 20

# Warehouse layout.  Rows are indexed top..bottom, robot Y grows upward
# (y = GRID_H-1-row_index).  '#' = static obstacle (wall / shelving rack),
# '.' = free cell, 'R1/R2/R3' = robot spawn markers (also free cells).
WAREHOUSE_MAP = [
    "####################",
    "#R1......#.......R2#",
    "#........#.........#",
    "#........#.........#",
    "#.....##...........#",
    "#.....##....##.....#",
    "#...........##.....#",
    "#.........##.......#",
    "#......###.........#",
    "#................R3#",
    "#.....##......##...#",
    "#..............##..#",
    "#.....##...........#",
    "#.................#.",
    "#.................#.",
    "#.................#.",
    "#.................#.",
    "#.................#.",
    "#.................#.",
    "####################",
]


def parse_map(world):
    """Parse ASCII map into obstacle set and per-robot spawn positions.

    Returns (obstacles: set[(x, y)], spawns: dict robot_id -> (x, y)).
    """
    obstacles = set()
    spawns = {}
    marker_re = re.compile(r"R([0-9])")
    for row_idx, line in enumerate(world):
        y = GRID_H - 1 - row_idx  # invert rows so y grows upward
        for m in marker_re.finditer(line):
            spawns[f"robot{m.group(1)}"] = (float(m.start()) + 0.5, float(y) + 0.5)
        for x, ch in enumerate(line):
            if ch == '#':
                obstacles.add((x, y))
    return obstacles, spawns


OBSTACLES, SPAWNS = parse_map(WAREHOUSE_MAP)

ROBOT_IDS = ["robot1", "robot2", "robot3"]

# Fixed delivery goals for the demo (README section 11: goals shipped per robot)
GOALS = {
    "robot1": (17.0, 13.0),
    "robot2": (2.0, 15.0),
    "robot3": (3.0, 2.0),
}

MAX_SPEED = 1.2        # m/s
MAX_TURN = 2.0         # rad/s
SAFE_REPULSION = 1.5   # proximity (m) that triggers inter-robot repulsion


def cell_free(x, y):
    cx, cy = int(math.floor(x)), int(math.floor(y))
    if (cx, cy) in OBSTACLES:
        return False
    return 0 <= cx < GRID_W and 0 <= cy < GRID_H


class LocalGNN:
    """Minimal message-passing GNN (placeholder for the research model).

    Two-layer MPNN: h_v = W2 · ReLU(W1 · [h_v || mean_{u∈N(v)} h_u]).
    Uses torch when available, otherwise a numpy fallback.  This keeps the
    same {node features, adjacency, output [v, omega]} interface the real
    GNN will use (README section 9).
    """

    def __init__(self, feature_dim=12):
        self.feature_dim = feature_dim
        hidden = 16
        try:
            import torch
            import torch.nn as nn
            self.torch = torch
            self.fc1 = nn.Linear(feature_dim * 2, hidden)
            self.fc2 = nn.Linear(hidden, 2)
        except Exception:
            self.torch = None
            self.W1 = np.random.randn(hidden, feature_dim * 2) * 0.1
            self.b1 = np.zeros(hidden)
            self.W2 = np.random.randn(2, hidden) * 0.1
            self.b2 = np.zeros(2)

    def act(self, self_state, neighbor_states):
        h_self = np.asarray(self_state, dtype=np.float32)
        if neighbor_states:
            neigh = np.asarray(neighbor_states, dtype=np.float32)
            h_agg = neigh.mean(axis=0)
        else:
            h_agg = np.zeros_like(h_self)
        x = np.concatenate([h_self, h_agg])

        if self.torch is not None:
            with self.torch.no_grad():
                t = self.torch.from_numpy(x).unsqueeze(0)
                out = self.fc2(self.torch.relu(self.fc1(t)))
            return out.squeeze(0).numpy()
        h = np.tanh(self.W1 @ x + self.b1)
        return self.W2 @ h + self.b2


def robot_feature_vector(state: RobotState) -> list:
    """Node feature vector for the GNN (README section 9)."""
    return [
        state.x, state.y, state.theta,
        state.vx, state.vy, state.omega,
        state.goal_x, state.goal_y,
        state.obstacle_distance,
        0.0, 0.0, 0.0,  # placeholder: comm quality / battery / mission id
    ]


class RobotNode(Node):
    def __init__(self, robot_id: str):
        ns = "/" + robot_id
        super().__init__(node_name=f"{robot_id}_node", namespace=ns)
        self.robot_id = robot_id
        self.goal = GOALS[robot_id]

        # Own simulated pose/velocity
        self.x, self.y = SPAWNS[robot_id]
        self.theta = 0.0
        self._wall_sign = None
        self.vx, self.vy, self.omega = 0.0, 0.0, 0.0
        self.reached_goal = False

        self.declare_parameter("goal_x", self.goal[0])
        self.declare_parameter("goal_y", self.goal[1])

        # RMS fast profile is wrong for our Wi-Fi; drop reliability to best_effort
        qos = QoSProfile(
            depth=10,
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
        )

        # Subscribers for own + both neighbors (all three, so we can tell
        # who is alive and build a per-robot adjacency graph).
        self._other_states: dict[str, RobotState] = {}
        for rid in ROBOT_IDS:
            self.create_subscription(
                RobotState, f"/{rid}/state", self._make_cb(rid), qos
            )

        # Publishers
        self.state_pub = self.create_publisher(RobotState, f"/{self.robot_id}/state", qos)
        self.neighbors_pub = self.create_publisher(
            NeighborStates, f"/{self.robot_id}/neighbor_states", qos
        )
        self.action_pub = self.create_publisher(Twist, f"/{self.robot_id}/gnn_action", qos)

        self._gnn = LocalGNN()

        self.create_timer(0.1, self._step)  # 10 Hz control loop

        self.get_logger().info(
            f"{robot_id} spawned at ({self.x:.1f},{self.y:.1f}) -> goal {self.goal}"
        )

    def _make_cb(self, rid):
        def cb(msg: RobotState):
            self._other_states[rid] = msg
        return cb

    # -- control ------------------------------------------------------------

    def _step(self):
        self._move()
        self._publish_state()
        self._publish_neighbors_and_action()

    def _nearest_obstacle(self, look=8.0) -> float:
        """Distance to nearest obstacle along current heading."""
        return self._ray_clear(self.theta, look)

    def _ray_clear(self, angle, look):
        d = look
        for step in np.arange(0.05, look, 0.05):
            px = self.x + step * math.cos(angle)
            py = self.y + step * math.sin(angle)
            if not cell_free(px, py):
                d = step
                break
        return d

    def _steer_around_block(self):
        """Pick the side with more free space around the blocked heading."""
        best = 1.0
        best_hit = 0.0
        for sign in (1.0, -1.0):
            a = self.theta + sign * math.pi / 2.0
            hit = 0.0
            for step in np.arange(0.1, 2.0, 0.1):
                px = self.x + step * math.cos(a)
                py = self.y + step * math.sin(a)
                if not cell_free(px, py):
                    break
                hit = step
            if hit > best_hit:
                best_hit, best = hit, sign
        return best

    def _move(self):
        dx = self.goal[0] - self.x
        dy = self.goal[1] - self.y
        dist = math.hypot(dx, dy)

        if dist < 0.3:
            self.reached_goal = True
            self.vx = self.vy = self.omega = 0.0
            self._wall_sign = None
            return

        self.reached_goal = False
        heading = math.atan2(dy, dx)
        ang_err = (heading - self.theta + math.pi) % (2 * math.pi) - math.pi

        # Inter-robot repulsion (decentralized coordination term).
        rep = [0.0, 0.0]
        for s in self._other_states.values():
            ox, oy = s.x, s.y
            d = math.hypot(ox - self.x, oy - self.y)
            if 0.0 < d < SAFE_REPULSION:
                f = (SAFE_REPULSION - d) / SAFE_REPULSION
                rep[0] += f * (self.x - ox) / max(d, 0.05)
                rep[1] += f * (self.y - oy) / max(d, 0.05)

        blocked = self._nearest_obstacle(look=0.6) < 0.55

        if blocked:
            # Wall-follow: pick a side once, keep turning homogeneously
            if self._wall_sign is None:
                self._wall_sign = self._steer_around_block()
            target = self.theta + self._wall_sign * math.pi / 2.0
            turn_err = (target - self.theta + math.pi) % (2 * math.pi) - math.pi
            self.omega = 2.0 * turn_err
            self.vx = self.vy = 0.0
        elif self._wall_sign is not None:
            # Continue along the wall; fall back to goal once the direct
            # ray toward the goal is obstacle-free again.
            spd = MAX_SPEED * 0.7
            self.vx = spd * math.cos(self.theta) + rep[0]
            self.vy = spd * math.sin(self.theta) + rep[1]
            self.omega = 0.0
            if self._ray_clear(heading, 2.0) > 1.8:
                self._wall_sign = None
        else:
            spd = MAX_SPEED
            if dist < 1.5:  # slow down near goal
                spd *= max(0.15, dist / 1.5)
            vx = spd * math.cos(self.theta) + rep[0]
            vy = spd * math.sin(self.theta) + rep[1]
            self.omega = 1.5 * ang_err

            # never commit a move into a wall
            nx, ny = self.x + vx * 0.1, self.y + vy * 0.1
            if not cell_free(nx, ny):
                nxr = self.x + 0.1 * (vx * math.cos(self.omega * 0.1)
                                      - vy * math.sin(self.omega * 0.1))
                nyr = self.y + 0.1 * (vx * math.sin(self.omega * 0.1)
                                      + vy * math.cos(self.omega * 0.1))
                if cell_free(nxr, nyr):
                    vx, vy = vx * math.cos(self.omega * 0.1) - vy * math.sin(self.omega * 0.1), \
                             vx * math.sin(self.omega * 0.1) + vy * math.cos(self.omega * 0.1)
                else:
                    vx, vy, self.omega = 0.0, 0.0, 1.5 * ang_err
            self.vx, self.vy = vx, vy

        self.x += self.vx * 0.1
        self.y += self.vy * 0.1
        self.theta = (self.theta + self.omega * 0.1) % (2 * math.pi)

    # -- publishing ---------------------------------------------------------

    def _publish_state(self):
        msg = RobotState()
        msg.robot_id = self.robot_id
        msg.robot_num = ROBOT_IDS.index(self.robot_id) + 1
        msg.x = float(self.x)
        msg.y = float(self.y)
        msg.theta = float(self.theta)
        msg.vx = float(self.vx)
        msg.vy = float(self.vy)
        msg.omega = float(self.omega)
        msg.goal_x = float(self.goal[0])
        msg.goal_y = float(self.goal[1])
        msg.obstacle_distance = float(self._nearest_obstacle(look=6.0))
        msg.timestamp = datetime.now(timezone.utc).timestamp()
        self.state_pub.publish(msg)

    def _publish_neighbors_and_action(self):
        alive = [self._other_states[r] for r in ROBOT_IDS if r in self._other_states]
        alive.sort(key=lambda s: s.robot_num)

        ns = NeighborStates()
        ns.neighbors = alive
        self.neighbors_pub.publish(ns)

        # GNN coordination -> action [v, omega]
        self_state = robot_feature_vector(self._as_state())
        neigh_feats = [robot_feature_vector(s) for s in alive]
        out = self._gnn.act(self_state, neigh_feats)

        twist = Twist()
        k = 0.5
        twist.linear.x = float(max(-MAX_SPEED, min(MAX_SPEED, k * out[0])))
        twist.angular.z = float(max(-MAX_TURN, min(MAX_TURN, k * out[1])))
        self.action_pub.publish(twist)

    def _as_state(self) -> RobotState:
        s = RobotState()
        s.robot_id = self.robot_id
        s.robot_num = ROBOT_IDS.index(self.robot_id) + 1
        s.x, s.y, s.theta = float(self.x), float(self.y), float(self.theta)
        s.vx, s.vy, s.omega = float(self.vx), float(self.vy), float(self.omega)
        s.goal_x, s.goal_y = float(self.goal[0]), float(self.goal[1])
        s.obstacle_distance = float(self._nearest_obstacle(look=6.0))
        s.timestamp = float(datetime.now(timezone.utc).timestamp())
        return s


def main(argv=None):
    parser = argparse.ArgumentParser(description="AMR robot simulation node")
    parser.add_argument(
        "--namespace",
        default=os.environ.get("ROBOT_ID", "robot1"),
        choices=ROBOT_IDS,
    )
    args, unknown = parser.parse_known_args(argv)

    rclpy.init(args=unknown)
    try:
        node = RobotNode(args.namespace)
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        rclpy.shutdown()


if __name__ == "__main__":
    main()