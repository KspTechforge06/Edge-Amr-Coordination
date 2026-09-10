# RobotState.msg
# State representation of an AMR per README section 8

string robot_id
int32 robot_num

float32 x
float32 y
float32 theta

float32 vx
float32 vy
float32 omega

float32 goal_x
float32 goal_y

float32 obstacle_distance

# seconds since epoch of publishing
float64 timestamp