const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildList } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

class DungeonExplorationMgrService extends BaseService {
  constructor() {
    super("dungeonExplorationMgr");
  }

  buildEscalatingPathDetails() {
    log.debug("[DungeonExplorationMgr] GetMyEscalatingPathDetails");
    return buildList([]);
  }

  Handle_GetMyEscalatingPathDetails() {
    return this.buildEscalatingPathDetails();
  }

  GetMyEscalatingPathDetails() {
    return this.buildEscalatingPathDetails();
  }
}

module.exports = DungeonExplorationMgrService;
