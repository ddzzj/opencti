import { shutdownModules, startModules } from '../../src/modules';
import { addThreatActor } from '../../src/domain/threatActor';
import { SYSTEM_USER } from '../../src/utils/access';
import { createRelation, deleteElement } from '../../src/database/middleware';
import { RELATION_ATTRIBUTED_TO, RELATION_USES } from '../../src/schema/stixCoreRelationship';
import { RULE_PREFIX } from '../../src/schema/general';
import AttributionUseRule from '../../src/rules/attribution-use/AttributionUseRule';
import { activateRule, disableRule, getInferences, inferenceLookup } from './rule-utils';
import { FIVE_MINUTES } from '../utils/testQuery';

const RULE = RULE_PREFIX + AttributionUseRule.id;
const APT41 = 'intrusion-set--d12c5319-f308-5fef-9336-20484af42084';
const PARADISE_RANSOMWARE = 'malware--21c45dbe-54ec-5bb7-b8cd-9f27cc518714';
const TLP_WHITE_ID = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';

describe('Attribute use rule', () => {
  // eslint-disable-next-line prettier/prettier
  it('Should rule successfully activated', async () => {
      // Start
      await startModules();
      // ---- Create the dataset
      // 01. Create a threat actor
      const threat = await addThreatActor(SYSTEM_USER, { name: 'MY TREAT ACTOR' });
      const MY_THREAT = threat.standard_id;
      // 02. Create require relation
      // APT41 -> uses -> Paradise (start: 2020-02-28T23:00:00.000Z, stop: 2020-02-29T23:00:00.000Z, confidence: 30)
      await createRelation(SYSTEM_USER, {
        fromId: APT41,
        toId: threat.id,
        start_time: '2020-01-20T20:30:00.000Z',
        stop_time: '2020-02-29T14:00:00.000Z',
        confidence: 10,
        relationship_type: RELATION_ATTRIBUTED_TO,
        objectMarking: [TLP_WHITE_ID],
      });
      // ---- Rule execution
      // Check that no inferences exists
      const beforeActivationRelations = await getInferences(RELATION_USES);
      expect(beforeActivationRelations.length).toBe(0);
      // Activate rules
      await activateRule(AttributionUseRule.id);
      // Check database state
      const afterActivationRelations = await getInferences(RELATION_USES);
      expect(afterActivationRelations.length).toBe(1);
      // eslint-disable-next-line prettier/prettier
      const myThreatToParadise = await inferenceLookup(afterActivationRelations, MY_THREAT, PARADISE_RANSOMWARE, RELATION_USES);
      expect(myThreatToParadise).not.toBeNull();
      expect(myThreatToParadise[RULE].length).toBe(1);
      expect(myThreatToParadise.confidence).toBe(20); // AVG 2 relations (30 + 10) = 20
      expect(myThreatToParadise.start_time).toBe('2020-02-28T23:00:00.000Z');
      expect(myThreatToParadise.stop_time).toBe('2020-02-29T14:00:00.000Z');
      // Create new element to trigger a live event
      // ---- base
      // TODO
      // Disable the rule
      await disableRule(AttributionUseRule.id);
      // Check the number of inferences
      const afterDisableRelations = await getInferences(RELATION_USES);
      expect(afterDisableRelations.length).toBe(0);
      // Clean
      await deleteElement(SYSTEM_USER, threat);
      // Stop
      await shutdownModules();
    },
    FIVE_MINUTES
  );
});
