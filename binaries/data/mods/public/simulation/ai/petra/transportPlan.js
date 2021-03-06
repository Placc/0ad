var PETRA = function(m)
{

/*
 Describes a transport plan
 Constructor assign units (units is an ID array, or an ID), a destionation (position, ingame), and a wanted escort size.
 The naval manager will try to deal with it accordingly.
 
 By this I mean that the naval manager will find how to go from access point 1 to access point 2 (relying on in-game pathfinder for mvt)
 And then carry units from there.
 
 Note: only assign it units currently over land, or it won't work.
 Also: destination should probably be land, otherwise the units will be lost at sea.
*/

// TODO: finish the support of multiple accessibility indexes.
// TODO: this doesn't check we can actually reach in the init, which we might want?

// TODO when a ship is destroyed, remove the entities inside from this.units

// metadata for units:
// transport = this.ID
// onBoard = ship.id() when affected to a ship but not yet garrisoned
//         = "onBoard" when garrisoned in a ship
//         = undefined otherwise
// endPos  = position of destination
//
// metadata for ships
// transporter = this.ID

//m.TransportPlan = function(gameState, units, destination, allAtOnce, escortSize) {
m.TransportPlan = function(gameState, units, startIndex, endIndex, endPos)
{
	this.ID = m.playerGlobals[PlayerID].uniqueIDTPlans++;
	this.debug = gameState.ai.HQ.Config.debug;

	this.endPos = endPos;
	this.endIndex = endIndex
	this.startIndex = startIndex;
	// TODO only cases with land-sea-land are allowed for the moment
	// we could also have land-sea-land-sea-land
	this.sea = gameState.ai.HQ.getSeaIndex(gameState, startIndex, endIndex);
	if (!this.sea)
	{
		this.failed = true;
		if (this.debug > 0)
			warn("transport plan with bad path: startIndex " + startIndex + " endIndex " + endIndex);
		return false;
	}
	
	this.units = gameState.getOwnUnits().filter(API3.Filters.byMetadata(PlayerID, "transport", this.ID));
	this.units.registerUpdates();

	for each (var ent in units)
	{
		ent.setMetadata(PlayerID, "transport", this.ID);
		ent.setMetadata(PlayerID, "endPos", endPos);
	}

	if (this.debug > 0)
		warn("Starting a new transport plan with ID " +  this.ID + " to index " + endIndex
			+ " with units length " + units.length);

	var allAtOnce = false;
	var escortSize = false;
	if (allAtOnce)
		this.allAtOnce = allAtOnce;
	else
		this.allAtOnce = false;

	if (escortSize)
		this.escortSize = escortSize;
	else
		this.escortSize = 0;
	
	this.ships = gameState.ai.HQ.navalManager.ships.filter(API3.Filters.byMetadata(PlayerID, "transporter", this.ID));
	// note: those two can overlap (some transport ships are warships too and vice-versa).
	this.transportShips = gameState.ai.HQ.navalManager.transportShips.filter(API3.Filters.byMetadata(PlayerID, "transporter", this.ID));
	this.escortShips = gameState.ai.HQ.navalManager.warShips.filter(API3.Filters.byMetadata(PlayerID, "transporter", this.ID));
	
	this.ships.registerUpdates();
	this.transportShips.registerUpdates();
	this.escortShips.registerUpdates();

	this.state = "boarding";
	this.boardingPos = {};
	this.needTransportShips = true;
	return true;
};

// count available slots
m.TransportPlan.prototype.countFreeSlots = function()
{
	var self = this;
	var slots = 0;
	this.transportShips.forEach(function (ship) { slots += self.countFreeSlotsOnShip(ship); });
};

m.TransportPlan.prototype.countFreeSlotsOnShip = function(ship)
{
	var occupied = ship.garrisoned().length
		+ this.units.filter(API3.Filters.byMetadata(PlayerID, "onBoard", ship.id())).length;
	return ship.garrisonMax() - occupied;
};

m.TransportPlan.prototype.assignUnitToShip = function(ent)
{
	var self = this;
	var done = false;
	this.transportShips.forEach(function (ship) {
		if (done)
			return;
		if (self.countFreeSlotsOnShip(ship) > 0)
		{
			ent.setMetadata(PlayerID, "onBoard", ship.id());
			done = true;
			if (self.debug > 0)
			{
				if (ent.getMetadata(PlayerID, "role") === "attack")
					Engine.PostCommand(PlayerID,{"type": "set-shading-color", "entities": [ent.id()], "rgb": [2,0,0]});
				else
					Engine.PostCommand(PlayerID,{"type": "set-shading-color", "entities": [ent.id()], "rgb": [0,2,0]});
			}
		}
	});
	if (!done)
		this.needTransportShips = true;
};

m.TransportPlan.prototype.assignShip = function(ship)
{
	ship.setMetadata(PlayerID, "transporter", this.ID);
};

// add a unit to this plan
m.TransportPlan.prototype.addUnit = function(unit, endPos)
{
	unit.setMetadata(PlayerID, "transport", this.ID);
	unit.setMetadata(PlayerID, "endPos", endPos);
};

m.TransportPlan.prototype.releaseAll = function()
{
	this.ships.forEach(function (ent) { ent.setMetadata(PlayerID, "transporter", undefined); });
	this.units.forEach(function (ent) {
		ent.setMetadata(PlayerID, "endPos", undefined);
		ent.setMetadata(PlayerID, "onBoard", undefined);
		ent.setMetadata(PlayerID, "transport", undefined);
// TODO if the index of the endPos of the entity is !== , require again another transport (we could need land-sea-land-sea-land)
	});
};

m.TransportPlan.prototype.releaseAllShips = function()
{
	this.ships.forEach(function (ent) { ent.setMetadata(PlayerID, "transporter", undefined) });
};

m.TransportPlan.prototype.needEscortShips = function()
{
	return !(this.escortShips.length < this.escortSize);
};

m.TransportPlan.prototype.cancelTransport = function(gameState)
{
	var ent = this.units.toEntityArray()[0];
	var base = gameState.ai.HQ.baseManagers[ent.getMetadata(PlayerID, "base")];
	if (!base.anchor || !base.anchor.position())
	{
		for (var i in gameState.ai.HQ.baseManagers)
		{
			base = gameState.ai.HQ.baseManagers[i];
			if (base.anchor && base.anchor.position())
			{
				ent.setMetadata(PlayerID, "base", +i);
				break;
			}
		}
		if (!base.anchor || !base.anchor.position())
			return false;
		this.units.forEach(function (ent) {
			ent.setMetadata(PlayerID, "base", base);
		});
	}
	this.endIndex = this.startIndex;
	this.endPos = base.anchor.position();
	this.canceled = true;;
	return true;
};


// try to move on.
/* several states:
 "unstarted" is the initial state, and will determine wether we follow basic or grouping path
 Basic path:
 - "waitingForBoarding" means we wait 'till we have enough transport ships and escort ships to move stuffs.
 - "Boarding" means we're trying to board units onto our ships
 - "Moving" means we're moving ships
 - "Unboarding" means we're unbording
 - Once we're unboarded, we either return to boarding point (if we still have units to board) or we clear.
	> there is the possibility that we'll be moving units on land, but that's basically a restart too, with more clearing.
 Grouping Path is basically the same with "grouping" and we never unboard (unless there is a need to)
 */

m.TransportPlan.prototype.update = function(gameState)
{
	if (this.state === "boarding")
		this.onBoarding(gameState);
	else if (this.state === "sailing")
		this.onSailing(gameState);

	return this.units.length;
};

m.TransportPlan.prototype.onBoarding = function(gameState)
{
	var ready = true;
	var self = this;
	var time = gameState.getTimeElapsed();
	this.units.forEach(function (ent) {
		if (!ent.getMetadata(PlayerID, "onBoard"))
		{
			ready = false;
			self.assignUnitToShip(ent);
			if (ent.getMetadata(PlayerID, "onBoard"))
			{
				var shipId = ent.getMetadata(PlayerID, "onBoard");
				var ship = gameState.getEntityById(shipId);
				if (!self.boardingPos[shipId])
				{
					self.boardingPos[shipId] = self.getBoardingPos(gameState, self.startIndex, self.sea, ent.position(), false);
					ship.move(self.boardingPos[shipId][0], self.boardingPos[shipId][1]);
					ship.setMetadata(PlayerID, "timeGarrison", time);
				}
				ent.garrison(ship);
				ent.setMetadata(PlayerID, "timeGarrison", time);
			}
		}
		else if (ent.getMetadata(PlayerID, "onBoard") !== "onBoard" && !self.isOnBoard(ent))
		{
			ready = false;
			var shipId = ent.getMetadata(PlayerID, "onBoard");
			var ship = gameState.getEntityById(shipId);
			if (!ship)    // the ship must have been destroyed
				ent.setMetadata(PlayerID, "onBoard", undefined);
			else
			{
				if (time - ship.getMetadata(PlayerID, "timeGarrison") > 10000)
				{
					ship.move(self.boardingPos[shipId][0], self.boardingPos[shipId][1]);
					ship.setMetadata(PlayerID, "timeGarrison", time);				
				}
				else if (time - ent.getMetadata(PlayerID, "timeGarrison") > 2000)
				{
					ent.garrison(ship);
					ent.setMetadata(PlayerID, "timeGarrison", time);
				}
			}
		}
	});

	if (!ready)
		return;

	this.ships.forEach(function (ship) { self.boardingPos[ship.id()] = undefined; });
	this.ships.forEach(function (ship) {
		self.boardingPos[ship.id()] = self.getBoardingPos(gameState, self.endIndex, self.sea, self.endPos, true);
		ship.move(self.boardingPos[ship.id()][0], self.boardingPos[ship.id()][1]);
	});
	this.state = "sailing";
	this.nTry = {};
	this.unloaded = [];
	this.recovered = [];
};

// tell if a unit is garrisoned in one of the ships of this plan, and update its metadata if yes
m.TransportPlan.prototype.isOnBoard = function(ent)
{
	var ret = false;
	var self = this;
	this.transportShips.forEach(function (ship) {
		if (ret || ship._entity.garrisoned.indexOf(ent.id()) === -1)
			return;
		ret = true;
		ent.setMetadata(PlayerID, "onBoard", "onBoard");
		if (self.debug > 0)
		{
			if (ent.getMetadata(PlayerID, "role") === "attack")
				Engine.PostCommand(PlayerID,{"type": "set-shading-color", "entities": [ent.id()], "rgb": [0,0,2]});
			else
				Engine.PostCommand(PlayerID,{"type": "set-shading-color", "entities": [ent.id()], "rgb": [1,1,1]});
		}
	});
	return ret;
};

// when avoidEnnemy is true, we try to not board/unboard in ennemy territory
m.TransportPlan.prototype.getBoardingPos = function(gameState, landIndex, seaIndex, destination, avoidEnnemy)
{
	if (!gameState.ai.HQ.navalManager.landingZones[landIndex][seaIndex])
	{
		warn(" >>> no landing zone for land " + landIndex + " and sea " + seaIndex);
		return destination;
	}

	var startPos = 	this.transportShips.getCentrePosition();
	var distmin = Math.min();
	var posmin = destination;
	var width = gameState.getMap().width;
	var cell = gameState.cellSize;
	for each (var i in gameState.ai.HQ.navalManager.landingZones[landIndex][seaIndex])
	{
		var pos = [i%width+0.5, Math.floor(i/width)+0.5];
		pos = [cell*pos[0], cell*pos[1]];
		var dist = API3.SquareVectorDistance(startPos, pos);
		if (destination)
			dist += API3.SquareVectorDistance(pos, destination);
		if (avoidEnnemy)
		{
			var territoryOwner = gameState.ai.HQ.territoryMap.getOwner(pos);
			if (territoryOwner != 0 && !gameState.isPlayerAlly(territoryOwner))
				dist += 100000000;
		}
		// require a small distance between all ships of the transport plan to avoid path finder problems
		// this is also used when the ship is blocked and we want to find a new boarding point
		for (var shipId in this.boardingPos)
			if (this.boardingPos[shipId] !== undefined && API3.SquareVectorDistance(this.boardingPos[shipId], pos) < 100)
				dist += 1000000;
		if (dist > distmin)
			continue;
		distmin = dist;
		posmin = pos
	}
	return posmin;
};

m.TransportPlan.prototype.onSailing = function(gameState)
{
	var self = this;

	// Check that the units recovered on the previous turn have been reloaded
	for each (var recov in this.recovered)
	{
		var ent = gameState.getEntityById(recov.entId);
		if (!ent)  // entity destroyed
			continue;
		if (!ent.position())  // reloading succeeded ... move a bit the ship before trying again
		{
			var ship = gameState.getEntityById(recov.shipId);
			if (ship)
				ship.moveApart(recov.entPos, 15);
			continue;
		}
		if (gameState.ai.HQ.Config.debug > 0)
			warn(">>> reloading failed ... <<<");
		// destroy the unit if inaccessible otherwise leave it 
		var index = gameState.ai.accessibility.getAccessValue(ent.position());
		if (gameState.ai.HQ.allowedRegions.indexOf(index) !== -1)
		{
			ent.setMetadata(PlayerID, "transport", undefined);
			ent.setMetadata(PlayerID, "onBoard", undefined);
			ent.setMetadata(PlayerID, "endPos", undefined);
			if (gameState.ai.HQ.Config.debug > 0)
				warn("recovered entity kept " + ent.id());
		}
		else
		{
			if (gameState.ai.HQ.Config.debug > 0)
				warn("recovered entity destroyed " + ent.id());
			ent.destroy();
		}
	}
	this.recovered = [];

	// Check that the units unloaded on the previous turn have been really unloaded
	var shipsToMove = {};
	for each (var entId in this.unloaded)
	{
		var ent = gameState.getEntityById(entId);
		if (!ent)  // entity destroyed
			continue;
		else if (!ent.position())  // unloading failed
		{
			var ship = gameState.getEntityById(ent.getMetadata(PlayerID, "onBoard"));
			if (ship)
			{
				if (ship._entity.garrisoned.indexOf(entId) !== -1)
					ent.setMetadata(PlayerID, "onBoard", "onBoard");
				else
				{
					warn("Petra transportPlan problem: unit not on ship without position ???");
					ent.destroy();
				}
			}
			else
			{
				warn("Petra transportPlan problem: unit on ship, but no ship ???");
				ent.destroy();
			}
		}
		else if (gameState.ai.accessibility.getAccessValue(ent.position()) !== this.endIndex)
		{
			// unit unloaded on a wrong region - try to regarrison it and move a bit the ship
			if (gameState.ai.HQ.Config.debug > 0)
				warn(">>> unit unloaded on a wrong region ! try to garrison it again <<<");
			var ship = gameState.getEntityById(ent.getMetadata(PlayerID, "onBoard"));
			if (ship && !this.canceled)
			{
				shipsToMove[ship.id()] = ship;
				this.recovered.push( {"entId": ent.id(), "entPos": ent.position(), "shipId": ship.id()} );
				ent.garrison(ship);
				ent.setMetadata(PlayerID, "onBoard", "onBoard");
			}
			else
			{
				if (gameState.ai.HQ.Config.debug > 0)
					warn("no way ... we destroy it");
				ent.destroy();
			}
		}
		else
		{
			ent.setMetadata(PlayerID, "transport", undefined);
			ent.setMetadata(PlayerID, "onBoard", undefined);
			ent.setMetadata(PlayerID, "endPos", undefined);
		}
	}
	for (var shipId in shipsToMove)
	{
		this.boardingPos[shipId] = this.getBoardingPos(gameState, this.endIndex, this.sea, this.endPos, true);
		shipsToMove[shipId].move(this.boardingPos[shipId][0], this.boardingPos[shipId][1]);
	}
	this.unloaded = [];

	if (this.canceled)
	{
		this.ships.forEach(function (ship) { self.boardingPos[ship.id()] = undefined; });
		this.ships.forEach(function (ship) {
			self.boardingPos[ship.id()] = self.getBoardingPos(gameState, self.endIndex, self.sea, self.endPos, true);
			ship.move(self.boardingPos[ship.id()][0], self.boardingPos[ship.id()][1]);
		});
		this.canceled = undefined;
	}

	this.transportShips.forEach(function (ship) {
		if (ship.unitAIState() === "INDIVIDUAL.WALKING")
			return;
		var shipId = ship.id();
		var dist = API3.SquareVectorDistance(ship.position(), self.boardingPos[shipId]);
		var remaining = 0;
		for each (var entId in ship._entity.garrisoned)
		{
			var ent = gameState.getEntityById(entId);
			if (!ent.getMetadata(PlayerID, "transport"))
				continue;
			remaining++;
			if (dist < 625)
			{
				ship.unload(entId);
				self.unloaded.push(entId);
				ent.setMetadata(PlayerID, "onBoard", shipId);
			}
		}

		if (remaining === 0)   // when empty, release the ship and move apart to leave room for other ships. TODO fight
		{
			ship.moveApart(self.boardingPos[shipId], 15);
			ship.setMetadata(PlayerID, "transporter", undefined);
			return;
		}

		if (dist > 225)
		{
			if (self.debug > 0)
				warn(shipId + " ship at distance " + dist + " avec state " + ship.unitAIState() + " et isIdle " + ship.isIdle());
			// we must have been blocked by something ... try again and then try with another boarding point
			if (!self.nTry[shipId])
				self.nTry[shipId] = 1;
			else
				++self.nTry[shipId];
			if (self.nTry[shipId] > 2)
			{
				self.nTry[shipId] = 0;
				if (self.debug > 0)
					warn(shipId + " new attempt for a landing point ");
				self.boardingPos[shipId] = self.getBoardingPos(gameState, self.endIndex, self.sea, undefined, true);
			}
			ship.move(self.boardingPos[shipId][0], self.boardingPos[shipId][1]);
		}
	});
};

return m;
}(PETRA);
