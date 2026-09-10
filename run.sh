#!/usr/bin/env bash
# Build + run the 3-AMR warehouse simulation in Docker.
# Uses plain `docker run` (no compose plugin required).
#
# Usage:
#   ./run.sh build   # build image + compile messages
#   ./run.sh up      # start robot1, robot2, robot3, warehouse_sim containers
#   ./run.sh logs    # follow robot container logs
#   ./run.sh shell   # interactive shell into the workspace image
#   ./run.sh down    # stop + remove containers
#   ./run.sh comet   # show live grid from the warehouse sim container

set -euo pipefail

cd "$(dirname "$0")"

IMG=amr_fleet:ros2-humble
NET="--network host"
IPC="--ipc=host"   # FastDDS SHM transport needs a shared IPC namespace
SRC="-v $PWD:/repo:rw,z"
X11="-v /tmp/.X11-unix:/tmp/.X11-unix:rw,z"
WS="source /opt/ros/humble/setup.bash && source /amr_fleet_ws/install/setup.bash"

common() {  # <container-id> <robot_namespace> <inherited-env...>
  local name=$1 ns=$2 extra_env=$3
  docker run -d $NET $IPC $X11 $SRC \
    --name "$name" \
    -e ROS_DOMAIN_ID=42 \
    -e ROBOT_ID="$ns" \
    -e ROS_NAMESPACE="/$ns" \
    $extra_env \
    "$IMG" bash -c "eval '$WS' && python3 /repo/src/amr_fleet/scripts/robot_node.py --namespace $ns"
}

case "${1:-}" in
  build)
    docker build -f docker/Dockerfile -t "$IMG" .
    ;;
  up)
    common amr_robot1 robot1 ""
    common amr_robot2 robot2 ""
    common amr_robot3 robot3 ""
    docker run -d $NET $IPC $X11 $SRC \
      --name amr_warehouse_sim \
      -e ROS_DOMAIN_ID=42 \
      "$IMG" bash -c "eval '$WS' && python3 /repo/src/amr_fleet/scripts/warehouse_sim.py"
    echo "started 3 robots + warehouse sim (ROS_DOMAIN_ID=42, host network)"
    ;;
  logs)
    docker logs -f "${2:-amr_robot1}"
    ;;
  comet)
    docker logs -f amr_warehouse_sim
    ;;
  shell)
    docker run -it --rm $NET $IPC $X11 $SRC -e ROS_DOMAIN_ID=42 "$IMG" bash
    ;;
  down)
    docker rm -f amr_robot1 amr_robot2 amr_robot3 amr_warehouse_sim 2>/dev/null || true
    ;;
  *)
    echo "usage: $0 {build|up|logs|shell|down|comet}"
    exit 1
    ;;
esac