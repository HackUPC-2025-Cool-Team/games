import pygame
import sys
import math
import random

WIDTH, HEIGHT = 800, 800
FPS = 45 
BALL_RADIUS = 10
BALL_SPEED = 3  
PADDLE_LENGTH = 100   
PADDLE_WIDTH = 10
RADIUS = 300        
PADDLE_SPEED = 5  

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
COLORS = [(255, 0, 0), (0, 255, 0), (0, 0, 255),
          (255, 255, 0), (255, 0, 255), (0, 255, 255)]

# Клавиши
KEY_BINDINGS = [
    [pygame.K_a, pygame.K_d], #red
    [pygame.K_LEFT, pygame.K_RIGHT], #green
    [pygame.K_j, pygame.K_l], #dark
    [pygame.K_z, pygame.K_c], #yellow
    [pygame.K_f, pygame.K_h], #rose
    [pygame.K_v, pygame.K_n], #ocyan
]

pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Пинг-Понг")
clock = pygame.time.Clock()
font = pygame.font.SysFont(None, 48)

# нум игроков
def get_number_of_players():
    box = pygame.Rect(WIDTH//3, HEIGHT//3, 200, 50)
    text = ""
    while True:
        screen.fill(BLACK)
        pygame.draw.rect(screen, WHITE, box, 2)
        screen.blit(font.render("players (2–6):", True, WHITE), (box.x, box.y-40))
        screen.blit(font.render(text, True, WHITE), (box.x+10, box.y+10))
        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                pygame.quit(); sys.exit()
            if e.type == pygame.KEYDOWN:
                if e.key == pygame.K_RETURN:
                    try:
                        n = int(text)
                        if 2 <= n <= 6:
                            return n
                    except:
                        pass
                elif e.key == pygame.K_BACKSPACE:
                    text = text[:-1]
                else:
                    text += e.unicode
        pygame.display.flip()

num_players = get_number_of_players()

# игроки
players = []
for i in range(num_players):
    players.append({
        'alive': True,
        'color': COLORS[i],
        'keys': KEY_BINDINGS[i],
        'offset': 0  
    })

# мяч
ball_pos   = [WIDTH//2, HEIGHT//2]
ball_angle = random.uniform(0, 2*math.pi)

def reset_ball():
    ball_pos[:] = [WIDTH//2, HEIGHT//2]
    return random.uniform(0, 2*math.pi)

# типо физика
def move_ball():
    ball_pos[0] += BALL_SPEED * math.cos(ball_angle)
    ball_pos[1] += BALL_SPEED * math.sin(ball_angle)

def reflect_ball(a, b):
    global ball_angle
    dx, dy = b[0]-a[0], b[1]-a[1]
    L = math.hypot(dx, dy)
    nx, ny = -dy/L, dx/L
    vx, vy = math.cos(ball_angle), math.sin(ball_angle)
    dot = vx*nx + vy*ny
    rx, ry = vx-2*dot*nx, vy-2*dot*ny
    ball_angle = math.atan2(ry, rx)

def point_line_distance(p, a, b):
    px, py = p; ax, ay = a; bx, by = b
    dx, dy = bx-ax, by-ay
    if dx==dy==0:
        return math.hypot(px-ax, py-ay)
    t = max(0, min(1, ((px-ax)*dx + (py-ay)*dy)/(dx*dx+dy*dy)))
    nx, ny = ax+t*dx, ay+t*dy
    return math.hypot(px-nx, py-ny)

# граф
def draw_arena_and_paddles():
    screen.fill(BLACK)
    alive = [p for p in players if p['alive']]
    n = len(alive)
    center = (WIDTH//2, HEIGHT//2)
    sides = []

    if n == 2:
#когда 2 юнита
        r = RADIUS * (2/num_players)
        rect = [
            (center[0]-r, center[1]-r),
            (center[0]+r, center[1]-r),
            (center[0]+r, center[1]+r),
            (center[0]-r, center[1]+r)
        ]
        pygame.draw.polygon(screen, WHITE, rect, 2)
       
        side_coords = [
            (rect[3], rect[0]),  # л
            (rect[1], rect[2])   # п
        ]
        for (a, b), p in zip(side_coords, alive):
            dx, dy = b[0]-a[0], b[1]-a[1]
            L = math.hypot(dx, dy)
            ux, uy = dx/L, dy/L
            max_off = (L/2 - PADDLE_LENGTH/2)
            mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
            off = max(-max_off, min(max_off, p['offset']))
            cx, cy = mx + ux*off, my + uy*off
            sx, sy = cx-ux*(PADDLE_LENGTH/2), cy-uy*(PADDLE_LENGTH/2)
            ex, ey = cx+ux*(PADDLE_LENGTH/2), cy+uy*(PADDLE_LENGTH/2)
            sides.append(((sx, sy), (ex, ey), p))
            pygame.draw.line(screen, p['color'], (sx, sy), (ex, ey), PADDLE_WIDTH)
    else:
        r = RADIUS * (n/num_players)
        verts = [
            (center[0]+math.cos(2*math.pi*i/n)*r,
             center[1]+math.sin(2*math.pi*i/n)*r)
            for i in range(n)
        ]
        pygame.draw.polygon(screen, WHITE, verts, 2)
        for i, p in enumerate(alive):
            a, b = verts[i], verts[(i+1)%n]
            dx, dy = b[0]-a[0], b[1]-a[1]
            L = math.hypot(dx, dy)
            ux, uy = dx/L, dy/L
            max_off = (L/2 - PADDLE_LENGTH/2)
            mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
            off = max(-max_off, min(max_off, p['offset']))
            cx, cy = mx + ux*off, my + uy*off
            sx, sy = cx-ux*(PADDLE_LENGTH/2), cy-uy*(PADDLE_LENGTH/2)
            ex, ey = cx+ux*(PADDLE_LENGTH/2), cy+uy*(PADDLE_LENGTH/2)
            sides.append(((sx, sy), (ex, ey), p))
            pygame.draw.line(screen, p['color'], (sx, sy), (ex, ey), PADDLE_WIDTH)

    pygame.draw.circle(screen, WHITE, (int(ball_pos[0]), int(ball_pos[1])), BALL_RADIUS)
    return sides

def check_collisions(sides):
    for a, b, _ in sides:
        if point_line_distance(ball_pos, a, b) <= BALL_RADIUS + PADDLE_WIDTH/2:
            reflect_ball(a, b)
            return True
    return False

def check_out():
    x, y = ball_pos
    cx, cy = WIDTH//2, HEIGHT//2
    if math.hypot(x-cx, y-cy) > RADIUS*(sum(p['alive'] for p in players)/num_players)+30:
        return True
    return False

ball_angle = reset_ball()
running = True
winner = None
while running:
    clock.tick(FPS)
    keys = pygame.key.get_pressed()
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            running = False

    # Управление
    for p in players:
        if not p['alive']:
            continue
        left, right = p['keys']
        if keys[left]:
            p['offset'] -= PADDLE_SPEED
        if keys[right]:
            p['offset'] += PADDLE_SPEED

    move_ball()
    sides = draw_arena_and_paddles()
    check_collisions(sides)

    if check_out():
        for a, b, p in sides:
            if point_line_distance(ball_pos, a, b) > BALL_RADIUS + PADDLE_WIDTH/2:
                p['alive'] = False
                break
        ball_angle = reset_ball()

    alive = [p for p in players if p['alive']]
    if len(alive) == 1 and not winner:
        winner = players.index(alive[0]) + 1

    if winner:
        txt = font.render(f"Победил Игрок {winner}", True, WHITE)
        screen.blit(txt, (WIDTH//2-150, HEIGHT//2-20))
    

    pygame.display.flip()

pygame.quit()
