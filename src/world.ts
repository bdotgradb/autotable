import { Vector2, Euler, Vector3, Quaternion } from "three";

interface Slot {
  position: Vector2;
  rotations: Array<Euler>;
  thingIndex: number | null;
  tempThingIndex: number | null;
  shiftNext: string | null;
  shiftPrev: string | null;
}

interface Thing {
  type: 'tile';
  index: number;
  slotName: string;
  rotationIndex: number;
  place: Place;
}

interface Place {
  position: Vector3;
  rotation: Euler;
  size: Vector3;
}

interface Render {
  thingIndex: number;
  place: Place;
  selected: boolean;
  hovered: boolean;
  held: boolean;
  temporary: boolean;
}

interface Select extends Place {
  id: any;
}

const Rotation = {
  FACE_UP: new Euler(0, 0, 0),
  FACE_UP_SIDEWAYS: new Euler(0, 0, Math.PI / 2),
  STANDING: new Euler(Math.PI / 2, 0, 0),
  FACE_DOWN: new Euler(Math.PI, 0, 0),
};

export class World {
  slots: Record<string, Slot> = {};
  pushes: Array<[string, string]> = [];
  things: Array<Thing> = [];

  hovered: number | null = null;
  selected: Array<number> = [];
  tablePos: Vector2 | null = null;

  targetSlots: Array<string | null> = [];
  held: Array<number> = [];
  heldTablePos: Vector2 | null = null;

  static TILE_WIDTH = 6;
  static TILE_HEIGHT = 9;
  static TILE_DEPTH = 4;
  static WIDTH = 174;
  static HEIGHT = 174;

  constructor() {
    this.addSlots();

    for (let i = 0; i < 17; i++) {
      for (let j = 0; j < 4; j++) {
        const index = j * 17 + i;
        const slotName = `wall.${i}.${j}`;
        const place = this.slotPlace(slotName, 0);
        this.things[index] = {
          type: 'tile',
          index: index % 34,
          slotName,
          place,
          rotationIndex: 0,
        };
        this.slots[slotName].thingIndex = index;
      }
    }
  }

  addSlots(): void {
    const defaults = {
      thingIndex: null,
      tempThingIndex: null,
      shiftNext: null,
      shiftPrev: null,
    };
    for (let i = 0; i < 14; i++) {
      this.addSlot(`hand.${i}`, {
        ...defaults,
        position: new Vector2(
          46 + i*World.TILE_WIDTH + World.TILE_WIDTH/2,
          World.TILE_DEPTH/2,
        ),
        rotations: [Rotation.STANDING, Rotation.FACE_UP],
      });
    }

    /*
    for (let i = 0; i < 12; i++) {
      baseSlots[`meld.${i}`] = {
        position: new Vector2(
          174 - (i+1)*World.TILE_WIDTH + World.TILE_WIDTH/2,
          World.TILE_HEIGHT/2,
        ),
        rotation: new Euler(0, 0, 0),
      };
    }
    */

    for (let i = 0; i < 17; i++) {
      this.addSlot(`wall.${i}`, {
        ...defaults,
        position: new Vector2(
          36 + i * World.TILE_WIDTH + World.TILE_WIDTH / 2,
          24 + World.TILE_HEIGHT/2,
        ),
        rotations: [Rotation.FACE_DOWN, Rotation.FACE_UP],
      });
    }

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 6; j++) {
        const n = 6 * i + j;
        this.addSlot(`discard.${n}`, {
          ...defaults,
          position: new Vector2(
            69 + j * World.TILE_WIDTH + World.TILE_WIDTH / 2,
            60 - i * World.TILE_HEIGHT + World.TILE_HEIGHT/2,
          ),
          rotations: [Rotation.FACE_UP, Rotation.FACE_UP_SIDEWAYS],
        });
        if (j < 5) {
          this.addPush(`discard.${n}`, `discard.${n+1}`);
        }
      }
    }
  }

  addSlot(slotName: string, slot: Slot): void {
    const qPlayer = new Quaternion();
    const step = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI/2);

    this.addRotatedSlot(slotName, '.0', slot, qPlayer);
    qPlayer.premultiply(step);
    this.addRotatedSlot(slotName, '.1', slot, qPlayer);
    qPlayer.premultiply(step);
    this.addRotatedSlot(slotName, '.2', slot, qPlayer);
    qPlayer.premultiply(step);
    this.addRotatedSlot(slotName, '.3', slot, qPlayer);
  }

  addPush(source: string, target: string): void {
    for (let i = 0; i < 4; i++) {
      this.pushes.push([`${source}.${i}`, `${target}.${i}`]);
    }
  }

  addRotatedSlot(slotName: string, suffix: string, slot: Slot, qPlayer: Quaternion): void {
    const newSlot = {...slot};

    const pos = new Vector3(
      slot.position.x - World.WIDTH / 2,
      slot.position.y - World.HEIGHT / 2,
    );
    pos.applyQuaternion(qPlayer);
    newSlot.position = new Vector2(pos.x + World.WIDTH / 2, pos.y + World.HEIGHT / 2);

    newSlot.rotations = slot.rotations.map(rot => {
      const q = new Quaternion().setFromEuler(rot);
      q.premultiply(qPlayer);
      return new Euler().setFromQuaternion(q);
    });

    this.slots[slotName + suffix] = newSlot;
  }

  onHover(id: any): void {
    if (this.held.length === 0) {
      this.hovered = id as number | null;
    }
  }

  onSelect(ids: Array<any>): void {
    this.selected = ids as Array<number>;
  }

  onMove(tablePos: Vector2 | null): void {
    this.tablePos = tablePos;
    if (this.tablePos !== null && this.heldTablePos !== null) {
      for (let i = 0; i < this.held.length; i++) {
        this.targetSlots[i] = null;
      }

      for (let i = 0; i < this.held.length; i++) {
        const thing = this.things[this.held[i]];
        const x = thing.place.position.x + this.tablePos.x - this.heldTablePos.x;
        const y = thing.place.position.y + this.tablePos.y - this.heldTablePos.y;

        this.targetSlots[i] = this.findSlot(x, y);
      }
    }
  }

  findSlot(x: number, y: number): string | null {
    let bestDistance = World.TILE_DEPTH * 1.5;
    let bestSlot = null;

    // Empty slots
    for (const slotName in this.slots) {
      const slot = this.slots[slotName];
      if (slot.thingIndex !== null && this.held.indexOf(slot.thingIndex) === -1) {
        continue;
      }
      // Already proposed for another thing
      if (this.targetSlots.indexOf(slotName) !== -1) {
        continue;
      }
      const place = this.slotPlace(slotName, 0);
      const dx = Math.max(0, Math.abs(x - slot.position.x) - place.size.x / 2);
      const dy = Math.max(0, Math.abs(y - slot.position.y) - place.size.y / 2);
      const distance = Math.sqrt(dx*dx + dy*dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSlot = slotName;
      }
    }
    return bestSlot;
  }

  onDragStart(): boolean {
    if (this.hovered !== null) {
      this.held.splice(0);

      if (this.selected.indexOf(this.hovered) !== -1) {
        this.held.push(...this.selected);
      } else {
        this.held.push(this.hovered);
        this.selected.splice(0);
      }
      // this.hovered = null;
      this.heldTablePos = this.tablePos;

      this.targetSlots.length = this.held.length;
      for (let i = 0; i < this.held.length; i++) {
        this.targetSlots[i] = null;
      }

      return true;
    }
    return false;
  }

  onDragEnd(): void {
    if (this.held.length > 0) {
      if (this.heldTablePos !== null && this.tablePos !== null &&
        // No movement; unselect
        this.heldTablePos.equals(this.tablePos)) {
        this.selected.splice(0);
        // if (this.hovered !== null) {
        //   this.selected.push(this.hovered);
        // }
      } else if (this.canDrop()) {
        // Successful movement
        this.drop();
      }
    }
    this.held.splice(0);
    this.targetSlots.splice(0);
  }

  onFlip(): void {
    if (this.held.length > 0) {
      return;
    }

    if (this.selected.length > 0) {
      for (const thingIndex of this.selected) {
        this.flip(thingIndex);
      }
    } else if (this.hovered !== null) {
      this.flip(this.hovered);
    }
  }

  flip(thingIndex: number): void {
    const thing = this.things[thingIndex];
    const slot = this.slots[thing.slotName];

    thing.rotationIndex = (thing.rotationIndex + 1) % slot.rotations.length;
    thing.place = this.slotPlace(thing.slotName, thing.rotationIndex);

    this.checkPushes();
  }

  drop(): void {
    for (let i = 0; i < this.held.length; i++) {
      const thingIndex = this.held[i];
      const thing = this.things[thingIndex];
      const oldSlotName = thing.slotName;
      this.slots[oldSlotName].thingIndex = null;
    }
    for (let i = 0; i < this.held.length; i++) {
      const thingIndex = this.held[i];
      const thing = this.things[thingIndex];
      const targetSlot = this.targetSlots[i]!;

      thing.slotName = targetSlot;
      thing.place = this.slotPlace(targetSlot, 0);
      thing.rotationIndex = 0;
      this.slots[targetSlot].thingIndex = thingIndex;
    }

    this.checkPushes();
  }

  canDrop(): boolean {
    return this.targetSlots.every(s => s !== null);
  }

  checkPushes(): void {
    for (const [source, target] of this.pushes) {
      const sourceThingIndex = this.slots[source].thingIndex;
      const targetThingIndex = this.slots[target].thingIndex;

      if (targetThingIndex === null) {
        continue;
      }

      const targetThing = this.things[targetThingIndex];
      targetThing.place = this.slotPlace(target, targetThing.rotationIndex);

      if (sourceThingIndex === null) {
        continue;
      }

      const sourceThing = this.things[sourceThingIndex];
      const dx = targetThing.place.position.x - sourceThing.place.position.x;
      const sizex = (targetThing.place.size.x + sourceThing.place.size.x) / 2;
      const dy = targetThing.place.position.y - sourceThing.place.position.y;
      const sizey = (targetThing.place.size.y + sourceThing.place.size.y) / 2;

      if (Math.abs(dx) > Math.abs(dy)) {
        const dist = sizex - Math.abs(dx);
        if (dist > 0) {
          targetThing.place.position.x += dx > 0 ? dist : -dist;
        }
      } else {
        const dist = sizey - Math.abs(dy);
        if (dist > 0) {
          targetThing.place.position.y += dy > 0 ? dist : -dist;
        }
      }
    }
  }

  toRender(): Array<Render> {
    const canDrop = this.canDrop();

    const result = [];
    for (let i = 0; i < this.things.length; i++) {
      const thing = this.things[i];
      let place = thing.place;
      const heldIndex = this.held.indexOf(i);
      const held = heldIndex !== -1;

      if (held && this.tablePos !== null && this.heldTablePos !== null) {
        place = {...place, position: place.position.clone()};
        place.position.x += this.tablePos.x - this.heldTablePos.x;
        place.position.y += this.tablePos.y - this.heldTablePos.y;
      }

      const selected = this.selected.indexOf(i) !== -1;
      const hovered = i === this.hovered ||
        (selected && this.selected.indexOf(this.hovered!) !== -1);
      const temporary = held && !canDrop;

      result.push({
        place,
        thingIndex: i,
        selected,
        hovered,
        held,
        temporary,
      });
    }
    return result;
  }

  toRenderGhosts(): Array<Render> {
    const result: Array<Render> = [];
    // if (this.targetSlot !== null) {
    //   const thingIndex = this.held;
    //   const place = this.slotPlace(this.slots[this.targetSlot]);
    //   result.push({
    //     ...place,
    //     thingIndex,
    //     selected: false,
    //     held: false,
    //   });
    // }
    return result;
  }

  toSelect(): Array<Select> {
    const result = [];
    if (this.held.length === 0) {
      // Things
      for (let i = 0; i < this.things.length; i++) {
        const thing = this.things[i];
        const place = thing.place;
        result.push({...place, id: i});
      }
    }
    return result;
  }

  slotPlace(slotName: string, rotationIndex: number): Place {
    const slot = this.slots[slotName];

    const rotation = slot.rotations[rotationIndex];

    const xv = new Vector3(0, 0, World.TILE_DEPTH).applyEuler(rotation);
    const yv = new Vector3(0, World.TILE_HEIGHT, 0).applyEuler(rotation);
    const zv = new Vector3(World.TILE_WIDTH, 0, 0).applyEuler(rotation);
    const maxx = Math.max(Math.abs(xv.x), Math.abs(yv.x), Math.abs(zv.x));
    const maxy = Math.max(Math.abs(xv.y), Math.abs(yv.y), Math.abs(zv.y));
    const maxz = Math.max(Math.abs(xv.z), Math.abs(yv.z), Math.abs(zv.z));

    const size = new Vector3(maxx, maxy, maxz);

    return {
      position: new Vector3(slot.position.x, slot.position.y, maxz/2),
      rotation: rotation,
      size,
    };
  }

  toRenderPlaces(): Array<Place> {
    const result = [];
    for (const slotName in this.slots) {
      result.push(this.slotPlace(slotName, 0));
    }
    return result;
  }

  toRenderShadows(): Array<Place> {
    const result = [];
    if (this.canDrop()) {
      for (const slotName of this.targetSlots) {
        result.push(this.slotPlace(slotName!, 0));
      }
    }
    return result;
  }
}
