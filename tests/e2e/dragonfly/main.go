// A real Bedrock server (Dragonfly) for end-to-end tests of the bridge's player body.
//
// It listens on RakNet without authentication, runs a flat world and speaks the same protocol
// version as bedrock-protocol 3.60.1 (1.26.50/51, protocol 2193). Everything the test needs to
// see is printed as one JSON object per line on stdout; commands arrive as JSON lines on stdin:
//
//	{"cmd":"tp","name":"Bot","x":10,"y":5,"z":10}
//	{"cmd":"setblock","x":3,"y":4,"z":0,"block":"stone"}      (stone | air | water | lava)
//	{"cmd":"kill","name":"Bot"}
//	{"cmd":"gamemode","name":"Bot","mode":"survival"}
//	{"cmd":"hurt","name":"Bot","damage":2}
//	{"cmd":"where"}
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/df-mc/dragonfly/server"
	"github.com/df-mc/dragonfly/server/block"
	"github.com/df-mc/dragonfly/server/block/cube"
	"github.com/df-mc/dragonfly/server/player"
	"github.com/df-mc/dragonfly/server/world"
	"github.com/go-gl/mathgl/mgl64"
)

var out = json.NewEncoder(os.Stdout)
var outMu sync.Mutex

func emit(v map[string]any) {
	outMu.Lock()
	defer outMu.Unlock()
	_ = out.Encode(v)
}

type handler struct {
	player.NopHandler
	name string
}

func (h *handler) HandleMove(ctx *player.Context, pos mgl64.Vec3, rot cube.Rotation) {
	emit(map[string]any{"e": "move", "name": h.name, "x": pos[0], "y": pos[1], "z": pos[2], "yaw": rot.Yaw(), "pitch": rot.Pitch()})
}
func (h *handler) HandleTeleport(ctx *player.Context, pos mgl64.Vec3) {
	emit(map[string]any{"e": "teleport", "name": h.name, "x": pos[0], "y": pos[1], "z": pos[2]})
}
func (h *handler) HandleJump(p *player.Player) { emit(map[string]any{"e": "jump", "name": h.name}) }
func (h *handler) HandleToggleSprint(ctx *player.Context, after bool) {
	emit(map[string]any{"e": "sprint", "name": h.name, "on": after})
}
func (h *handler) HandleHurt(ctx *player.Context, damage *float64, immune bool, attackImmunity *time.Duration, src world.DamageSource) {
	emit(map[string]any{"e": "hurt", "name": h.name, "damage": *damage, "immune": immune, "src": fmt.Sprintf("%T", src)})
}
func (h *handler) HandleDeath(p *player.Player, src world.DamageSource, keepInv *bool) {
	*keepInv = false
	emit(map[string]any{"e": "death", "name": h.name})
}
func (h *handler) HandleRespawn(p *player.Player, pos *mgl64.Vec3, w **world.World) {
	emit(map[string]any{"e": "respawn", "name": h.name, "x": pos[0], "y": pos[1], "z": pos[2]})
}
func (h *handler) HandleQuit(p *player.Player) { emit(map[string]any{"e": "quit", "name": h.name}) }
func (h *handler) HandleChat(ctx *player.Context, message *string) {
	emit(map[string]any{"e": "chat", "name": h.name, "message": *message})
}

func main() {
	if os.Getenv("DF_DEBUG") != "" {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	} else {
		slog.SetLogLoggerLevel(slog.LevelWarn)
	}
	uc := server.DefaultConfig()
	addr := os.Getenv("DF_ADDR")
	if addr == "" {
		addr = "127.0.0.1:19138"
	}
	uc.Network.Address = addr
	uc.Server.AuthEnabled = false
	uc.World.SaveData = false
	uc.Players.SaveData = false
	uc.Resources.AutoBuildPack = false
	conf, err := uc.Config(slog.Default())
	if err != nil {
		panic(err)
	}
	srv := conf.New()
	srv.CloseOnProgramEnd()
	srv.Listen()
	emit(map[string]any{"e": "ready", "addr": addr})

	go commands(srv)
	go ticker(srv)

	for p := range srv.Accept() {
		p.Handle(&handler{name: p.Name()})
		pos := p.Position()
		emit(map[string]any{"e": "join", "name": p.Name(), "x": pos[0], "y": pos[1], "z": pos[2], "gamemode": fmt.Sprintf("%T", p.GameMode())})
	}
}

// ticker reports where the server keeps every player a few times a second.
func ticker(srv *server.Server) {
	last := map[string]string{}
	for range time.Tick(100 * time.Millisecond) {
		_ = srv.World().Do(func(tx *world.Tx) {
			for p := range srv.Players(tx) {
				pos, rot := p.Position(), p.Rotation()
				key := fmt.Sprintf("%.3f %.3f %.3f %.1f %.1f %v", pos[0], pos[1], pos[2], rot.Yaw(), rot.Pitch(), p.Health())
				if last[p.Name()] == key {
					continue
				}
				last[p.Name()] = key
				emit(map[string]any{"e": "pos", "name": p.Name(), "x": pos[0], "y": pos[1], "z": pos[2], "yaw": rot.Yaw(), "pitch": rot.Pitch(), "health": p.Health()})
			}
		}).Wait(context.Background())
	}
}

type command struct {
	Cmd    string  `json:"cmd"`
	Name   string  `json:"name"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	Block  string  `json:"block"`
	Mode   string  `json:"mode"`
	Damage float64 `json:"damage"`
}

func commands(srv *server.Server) {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var c command
		if err := json.Unmarshal(sc.Bytes(), &c); err != nil {
			emit(map[string]any{"e": "error", "error": err.Error()})
			continue
		}
		_ = srv.World().Do(func(tx *world.Tx) {
			switch c.Cmd {
			case "setblock":
				var b world.Block = block.Air{}
				switch c.Block {
				case "stone":
					b = block.Stone{}
				case "water":
					b = block.Water{Still: true, Depth: 8}
				case "lava":
					b = block.Lava{Still: true, Depth: 8}
				}
				tx.SetBlock(cube.Pos{int(c.X), int(c.Y), int(c.Z)}, b, nil)
				emit(map[string]any{"e": "ok", "cmd": "setblock"})
			case "where":
				for p := range srv.Players(tx) {
					pos, rot := p.Position(), p.Rotation()
					emit(map[string]any{"e": "pos", "name": p.Name(), "x": pos[0], "y": pos[1], "z": pos[2], "yaw": rot.Yaw(), "pitch": rot.Pitch(), "health": p.Health()})
				}
			default:
				for p := range srv.Players(tx) {
					if p.Name() != c.Name {
						continue
					}
					switch c.Cmd {
					case "tp":
						p.Teleport(mgl64.Vec3{c.X, c.Y, c.Z})
					case "kill":
						p.Hurt(1000, killSource{})
					case "hurt":
						p.Hurt(c.Damage, killSource{})
					}
					emit(map[string]any{"e": "ok", "cmd": c.Cmd, "name": c.Name})
				}
			}
		}).Wait(context.Background())
	}
}

type killSource struct{}

func (killSource) ReducedByArmour() bool     { return false }
func (killSource) ReducedByResistance() bool { return false }
func (killSource) Fire() bool                { return false }
func (killSource) IgnoreTotem() bool         { return true }
