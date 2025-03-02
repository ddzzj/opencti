import * as R from 'ramda';
import {
  createEntity,
  createRelation,
  deleteElementById,
  deleteRelationsByFromAndTo,
  distributionEntities,
  distributionRelations,
  internalLoadById,
  listEntities,
  listRelations,
  loadById,
  mergeEntities,
  patchAttribute,
  querySubTypes,
  timeSeriesEntities,
  timeSeriesRelations,
  updateAttribute,
  fullLoadById,
} from '../../../src/database/middleware';
import { attributeEditField, findAll as findAllAttributes } from '../../../src/domain/attribute';
import { el, elFindByIds, elLoadById, ES_IGNORE_THROTTLED } from '../../../src/database/elasticSearch';
import { ADMIN_USER, sleep } from '../../utils/testQuery';
import {
  ENTITY_TYPE_CAMPAIGN,
  ENTITY_TYPE_CONTAINER_OBSERVED_DATA,
  ENTITY_TYPE_CONTAINER_REPORT,
  ENTITY_TYPE_IDENTITY_ORGANIZATION,
  ENTITY_TYPE_INDICATOR,
  ENTITY_TYPE_INTRUSION_SET,
  ENTITY_TYPE_MALWARE,
  ENTITY_TYPE_THREAT_ACTOR,
} from '../../../src/schema/stixDomainObject';
import { ABSTRACT_STIX_CORE_RELATIONSHIP, ABSTRACT_STIX_META_RELATIONSHIP } from '../../../src/schema/general';
import { RELATION_MITIGATES, RELATION_USES } from '../../../src/schema/stixCoreRelationship';
import { ENTITY_HASHED_OBSERVABLE_STIX_FILE } from '../../../src/schema/stixCyberObservable';
import { RELATION_OBJECT_LABEL, RELATION_OBJECT_MARKING } from '../../../src/schema/stixMetaRelationship';
import { addLabel } from '../../../src/domain/label';
import { ENTITY_TYPE_LABEL } from '../../../src/schema/stixMetaObject';
import {
  dayFormat,
  escape,
  monthFormat,
  now,
  prepareDate,
  sinceNowInMinutes,
  utcDate,
  yearFormat,
} from '../../../src/utils/format';
import { READ_DATA_INDICES } from '../../../src/database/utils';
import { INTERNAL_FROM_FIELD } from '../../../src/schema/identifier';
import { SYSTEM_USER } from '../../../src/utils/access';
import { checkObservableSyntax } from '../../../src/utils/syntax';
import { FunctionalError } from '../../../src/config/errors';

describe('Basic and utils', () => {
  it('should escape according to grakn needs', () => {
    expect(escape({ key: 'json' })).toEqual({ key: 'json' });
    expect(escape('simple ident')).toEqual('simple ident');
    expect(escape('grakn\\special')).toEqual('grakn\\\\special');
    expect(escape('grakn;injection')).toEqual('grakn\\;injection');
    expect(escape('grakn,injection')).toEqual('grakn\\,injection');
  });
  it('should date utils correct', () => {
    expect(utcDate().isValid()).toBeTruthy();
    expect(utcDate(now()).isValid()).toBeTruthy();
    expect(sinceNowInMinutes(now())).toEqual(0);
    // Test with specific timezone
    expect(prepareDate('2020-01-01T00:00:00.001+01:00')).toEqual('2019-12-31T23:00:00.001');
    expect(yearFormat('2020-01-01T00:00:00.001+01:00')).toEqual('2019');
    expect(monthFormat('2020-01-01T00:00:00.001+01:00')).toEqual('2019-12');
    expect(dayFormat('2020-01-01T00:00:00.001+01:00')).toEqual('2019-12-31');
    // Test with direct utc
    expect(prepareDate('2020-02-27T08:45:39.351Z')).toEqual('2020-02-27T08:45:39.351');
    expect(yearFormat('2020-02-27T08:45:39.351Z')).toEqual('2020');
    expect(monthFormat('2020-02-27T08:45:39.351Z')).toEqual('2020-02');
    expect(dayFormat('2020-02-27T08:45:39.351Z')).toEqual('2020-02-27');
  });
});

describe('Loaders', () => {
  it('should load subTypes values', async () => {
    const stixObservableSubTypes = await querySubTypes({ type: 'Stix-Cyber-Observable' });
    expect(stixObservableSubTypes).not.toBeNull();
    expect(stixObservableSubTypes.edges.length).toEqual(26);
    const subTypeLabels = R.map((e) => e.node.label, stixObservableSubTypes.edges);
    expect(R.includes('IPv4-Addr', subTypeLabels)).toBeTruthy();
    expect(R.includes('IPv6-Addr', subTypeLabels)).toBeTruthy();
  });
});

describe('Attribute updater', () => {
  // TODO JRI HOW TO CHECK THE ES SCHEMA
  it.skip('should update fail for unknown attributes', async () => {
    const campaign = await elLoadById(ADMIN_USER, 'campaign--92d46985-17a6-4610-8be8-cc70c82ed214');
    const campaignId = campaign.internal_id;
    const input = { observable_value: 'test' };
    const { element: update } = await patchAttribute(ADMIN_USER, campaignId, ENTITY_TYPE_CAMPAIGN, input);
    expect(update).rejects.toThrow();
  });
  it('should update dont do anything if already the same', async () => {
    const campaign = await elLoadById(ADMIN_USER, 'campaign--92d46985-17a6-4610-8be8-cc70c82ed214');
    const campaignId = campaign.internal_id;
    const patch = { description: 'A test campaign' };
    const { element: update } = await patchAttribute(ADMIN_USER, campaignId, ENTITY_TYPE_CAMPAIGN, patch);
    expect(update.internal_id).toEqual(campaignId);
  });
  it('should update date with dependencies', async () => {
    const stixId = 'campaign--92d46985-17a6-4610-8be8-cc70c82ed214';
    let campaign = await internalLoadById(ADMIN_USER, stixId);
    const campaignId = campaign.internal_id;
    expect(campaign.first_seen).toEqual('2020-02-27T08:45:43.365Z');
    const type = 'Stix-Domain-Object';
    let patch = { first_seen: '2020-02-20T08:45:43.366Z' };
    const { element: update01 } = await patchAttribute(ADMIN_USER, campaignId, type, patch);
    expect(update01.internal_id).toEqual(campaignId);
    campaign = await internalLoadById(ADMIN_USER, stixId);
    expect(campaign.first_seen).toEqual('2020-02-20T08:45:43.366Z');
    expect(campaign.i_first_seen_day).toEqual('2020-02-20');
    expect(campaign.i_first_seen_month).toEqual('2020-02');
    expect(campaign.i_first_seen_year).toEqual('2020');
    // Value back to before
    patch = { first_seen: '2020-02-27T08:45:43.365Z' };
    const { element: update02 } = await patchAttribute(ADMIN_USER, campaignId, type, patch);
    expect(update02.internal_id).toEqual(campaignId);
    campaign = await internalLoadById(ADMIN_USER, stixId);
    expect(campaign.first_seen).toEqual('2020-02-27T08:45:43.365Z');
    expect(campaign.i_first_seen_day).toEqual('2020-02-27');
  });
  it('should update numeric', async () => {
    const stixId = 'relationship--efc9bbb8-e606-4fb1-83ae-d74690fd0416';
    let relation = await loadById(ADMIN_USER, stixId, ABSTRACT_STIX_CORE_RELATIONSHIP);
    const relationId = relation.internal_id;
    // expect(relation.confidence).toEqual(1);
    let patch = { confidence: 5 };
    await patchAttribute(ADMIN_USER, relationId, RELATION_MITIGATES, patch);
    relation = await loadById(ADMIN_USER, stixId, ABSTRACT_STIX_CORE_RELATIONSHIP);
    expect(relation.confidence).toEqual(5);
    // Value back to before
    patch = { confidence: 1 };
    await patchAttribute(ADMIN_USER, relationId, RELATION_MITIGATES, patch);
    relation = await loadById(ADMIN_USER, stixId, ABSTRACT_STIX_CORE_RELATIONSHIP);
    expect(relation.confidence).toEqual(1);
  });
  it('should update multivalued attribute', async () => {
    const stixId = 'identity--72de07e8-e6ed-4dfe-b906-1e82fae1d132';
    const type = 'Stix-Domain-Object';
    let identity = await internalLoadById(ADMIN_USER, stixId);
    const identityId = identity.internal_id;
    expect(identity.x_opencti_aliases.sort()).toEqual(['Computer Incident', 'Incident'].sort());
    let patch = { x_opencti_aliases: ['Computer', 'Test', 'Grakn'] };
    await patchAttribute(ADMIN_USER, identityId, type, patch);
    identity = await internalLoadById(ADMIN_USER, stixId);
    expect(identity.x_opencti_aliases.sort()).toEqual(['Computer', 'Test', 'Grakn'].sort());
    // Value back to before
    patch = { x_opencti_aliases: ['Computer Incident', 'Incident'] };
    await patchAttribute(ADMIN_USER, identityId, type, patch);
    identity = await internalLoadById(ADMIN_USER, stixId);
    expect(identity.x_opencti_aliases.sort()).toEqual(['Computer Incident', 'Incident'].sort());
  });
});

describe('Entities listing', () => {
  // const { first = 1000, after, orderBy, orderMode = 'asc' }
  // filters part. Definition -> { key, values, fromRole, toRole }
  it('should list entities', async () => {
    const malwares = await listEntities(ADMIN_USER, ['Malware']);
    expect(malwares).not.toBeNull();
    expect(malwares.edges.length).toEqual(2);
    const dataMap = new Map(malwares.edges.map((i) => [R.head(i.node.x_opencti_stix_ids), i.node]));
    const malware = dataMap.get('malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    expect(malware.grakn_id).not.toBeNull();
    expect(malware.standard_id).toEqual('malware--21c45dbe-54ec-5bb7-b8cd-9f27cc518714');
    expect(malware.created_at_month).not.toBeNull();
    expect(malware.parent_types.length).toEqual(4);
    expect(R.includes('Stix-Domain-Object', malware.parent_types)).toBeTruthy();
    expect(R.includes('Stix-Core-Object', malware.parent_types)).toBeTruthy();
    expect(R.includes('Stix-Object', malware.parent_types)).toBeTruthy();
    expect(R.includes('Basic-Object', malware.parent_types)).toBeTruthy();
    expect(malware.created).toEqual('2019-09-30T16:38:26.000Z');
    expect(malware.name).toEqual('Paradise Ransomware');
    // eslint-disable-next-line
    expect(malware._index).not.toBeNull();
  });
  it('should list multiple entities', async () => {
    const entities = await listEntities(ADMIN_USER, ['Malware', 'Organization']);
    expect(entities).not.toBeNull();
    expect(entities.edges.length).toEqual(7); // 2 malwares + 8 organizations
    const aggregationMap = new Map(entities.edges.map((i) => [i.node.name, i.node]));
    expect(aggregationMap.get('Paradise Ransomware')).not.toBeUndefined();
    expect(aggregationMap.get('Allied Universal')).not.toBeUndefined();
    expect(aggregationMap.get('ANSSI')).not.toBeUndefined();
    expect(aggregationMap.get('France')).toBeUndefined(); // Stix organization convert to Country with OpenCTI
  });
  it('should list entities with basic filtering', async () => {
    const options = { first: 1, orderBy: 'created', orderMode: 'desc' };
    const indicators = await listEntities(ADMIN_USER, ['Indicator'], options);
    expect(indicators.edges.length).toEqual(1);
    const indicator = R.head(indicators.edges).node;
    expect(indicator.name).toEqual('www.xolod-teplo.ru');
  });
  it('should list entities with search', async () => {
    let options = { search: 'xolod' };
    let indicators = await listEntities(ADMIN_USER, ['Indicator'], options);
    expect(indicators.edges.length).toEqual(1);
    options = { search: 'location' };
    indicators = await listEntities(ADMIN_USER, ['Indicator'], options);
    expect(indicators.edges.length).toEqual(2);
    options = { search: 'i want a location' };
    indicators = await listEntities(ADMIN_USER, ['Indicator'], options);
    expect(indicators.edges.length).toEqual(3);
  });
  it('should list entities with attribute filters', async () => {
    const filters = [
      { key: 'x_mitre_id', values: ['T1369'] },
      { key: 'name', values: ['Spear phishing messages with malicious links'] },
    ];
    const options = { filters };
    const attacks = await listEntities(ADMIN_USER, ['Attack-Pattern'], options);
    expect(attacks).not.toBeNull();
    expect(attacks.edges.length).toEqual(1);
    expect(R.head(attacks.edges).node.standard_id).toEqual('attack-pattern--b5c4784e-6ecc-5347-a231-c9739e077dd8');
    expect(R.head(attacks.edges).node.x_opencti_stix_ids).toEqual([
      'attack-pattern--489a7797-01c3-4706-8cd1-ec56a9db3adc',
    ]);
  });
  it('should list multiple entities with attribute filters', async () => {
    const identity = await elLoadById(ADMIN_USER, 'identity--c78cb6e5-0c4b-4611-8297-d1b8b55e40b5');
    const filters = [{ key: `rel_created-by.internal_id`, values: [identity.internal_id] }];
    const options = { filters };
    const entities = await listEntities(ADMIN_USER, ['Attack-Pattern', 'Intrusion-Set'], options);
    expect(entities).not.toBeNull();
    expect(entities.edges.length).toEqual(3);
  });
});

describe('Relations listing', () => {
  // const { first = 1000, after, orderBy, orderMode = 'asc', inferred = false, forceNatural = false }
  // const { filters = [], search, fromRole, fromId, toRole, toId, fromTypes = [], toTypes = [] }
  // const { firstSeenStart, firstSeenStop, lastSeenStart, lastSeenStop, confidences = [] }
  // uses: { user: ROLE_FROM, usage: ROLE_TO }
  it('should list relations', async () => {
    const stixCoreRelationships = await listRelations(ADMIN_USER, 'stix-core-relationship');
    expect(stixCoreRelationships).not.toBeNull();
    expect(stixCoreRelationships.edges.length).toEqual(21);
    const stixMetaRelationships = await listRelations(ADMIN_USER, 'stix-meta-relationship');
    expect(stixMetaRelationships).not.toBeNull();
    expect(stixMetaRelationships.edges.length).toEqual(110);
  });
  it('should list relations with roles', async () => {
    const stixRelations = await listRelations(ADMIN_USER, 'uses', {
      fromRole: 'uses_from',
      toRole: 'uses_to',
    });
    expect(stixRelations).not.toBeNull();
    expect(stixRelations.edges.length).toEqual(3);
    for (let index = 0; index < stixRelations.edges.length; index += 1) {
      const stixRelation = stixRelations.edges[index].node;
      expect(stixRelation.fromRole).toEqual('uses_from');
      expect(stixRelation.toRole).toEqual('uses_to');
    }
  });
  it('should list relations with id option', async () => {
    // Just id specified,
    // "name": "Paradise Ransomware"
    const options = { fromId: 'ab78a62f-4928-4d5a-8740-03f0af9c4330' };
    const thing = await internalLoadById(ADMIN_USER, 'ab78a62f-4928-4d5a-8740-03f0af9c4330');
    const stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    for (let index = 0; index < stixRelations.edges.length; index += 1) {
      const stixRelation = stixRelations.edges[index].node;
      expect(stixRelation.fromId).toEqual(thing.grakn_id);
    }
  });
  it('should list relations with from types option', async () => {
    // Just id specified,
    // "name": "Paradise Ransomware"
    const intrusionSet = await internalLoadById(ADMIN_USER, 'intrusion-set--18854f55-ac7c-4634-bd9a-352dd07613b7');
    expect(intrusionSet.entity_type).toEqual('Intrusion-Set');
    const options = { fromId: intrusionSet.internal_id, fromTypes: ['Intrusion-Set'] };
    const stixRelations = await listRelations(ADMIN_USER, 'targets', options);
    expect(stixRelations.edges.length).toEqual(2);
    for (let index = 0; index < stixRelations.edges.length; index += 1) {
      const stixRelation = stixRelations.edges[index].node;
      expect(stixRelation.fromId).toEqual(intrusionSet.internal_id);
    }
  });
  it('should list relations with to types option', async () => {
    // Just id specified,
    // "name": "Paradise Ransomware"
    const malware = await internalLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const options = { fromId: malware.internal_id, toTypes: ['Attack-Pattern'] };
    const stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(2);
    for (let index = 0; index < stixRelations.edges.length; index += 1) {
      const stixRelation = stixRelations.edges[index].node;
      // eslint-disable-next-line no-await-in-loop
      const toThing = await elLoadById(ADMIN_USER, stixRelation.toId);
      expect(toThing.entity_type).toEqual('Attack-Pattern');
      expect(stixRelation.fromId).toEqual(malware.internal_id);
    }
  });
  it('should list relations with first and order filtering', async () => {
    const options = { first: 6, orderBy: 'created', orderMode: 'asc' };
    const stixRelations = await listRelations(ADMIN_USER, 'stix-core-relationship', options);
    expect(stixRelations).not.toBeNull();
    expect(stixRelations.edges.length).toEqual(6);
    // Every relations must have natural ordering for from and to
    for (let index = 0; index < stixRelations.edges.length; index += 1) {
      const stixRelation = stixRelations.edges[index].node;
      // eslint-disable-next-line camelcase
      const { fromRole, toRole, relationship_type: relationshipType } = stixRelation;
      expect(fromRole).toEqual(`${relationshipType}_from`);
      expect(toRole).toEqual(`${relationshipType}_to`);
    }
    const relation = R.head(stixRelations.edges).node;
    expect(relation.created).toEqual('2019-04-25T20:53:08.446Z');
  });
  it('should list relations with relation filtering', async () => {
    let stixRelations = await listRelations(ADMIN_USER, 'uses');
    expect(stixRelations).not.toBeNull();
    expect(stixRelations.edges.length).toEqual(3);
    // Filter the list through relation filter
    // [Malware: Paradise Ransomware] ---- (user) ---- <uses> ---- (usage) ---- [Attack pattern: Spear phishing messages with text only]
    //                                                   |
    //                                             (characterize)
    //                                                   |
    //                                              < indicates >
    //                                                   |
    //                                               (indicator)
    //                                                   |
    //                                     [Indicator: www.xolod-teplo.ru]
    const indicator = await elLoadById(ADMIN_USER, 'indicator--10e9a46e-7edb-496b-a167-e27ea3ed0079');
    const indicatorId = indicator.internal_id; // indicator -> www.xolod-teplo.ru
    const relationFilter = {
      relation: 'indicates',
      fromRole: 'indicates_to',
      toRole: 'indicates_from',
      id: indicatorId,
    };
    const options = { relationFilter };
    stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(0);
  });
  it('should list relations with relation filtering on report', async () => {
    const report = await elLoadById(ADMIN_USER, 'report--a445d22a-db0c-4b5d-9ec8-e9ad0b6dbdd7');
    const relationFilter = {
      relation: 'object',
      fromRole: 'object_to',
      toRole: 'object_from',
      id: report.internal_id,
    };
    const args = { relationFilter };
    const stixRelations = await listRelations(ADMIN_USER, 'stix-core-relationship', args);
    // TODO Ask Julien
    expect(stixRelations.edges.length).toEqual(11);
    const relation = await elLoadById(ADMIN_USER, 'relationship--b703f822-f6f0-4d96-9c9b-3fc0bb61e69c');
    const argsWithRelationId = {
      relationFilter: R.assoc('relationId', relation.internal_id, relationFilter),
    };
    const stixRelationsWithInternalId = await listRelations(ADMIN_USER, 'stix-core-relationship', argsWithRelationId);
    expect(stixRelationsWithInternalId.edges.length).toEqual(1);
  });
  it('should list relations with search', async () => {
    const malware = await elLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const options = { fromId: malware.internal_id, search: 'Spear phishing' };
    const stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(2);
    const relTargets = await Promise.all(R.map((s) => elLoadById(ADMIN_USER, s.node.toId), stixRelations.edges));
    for (let index = 0; index < relTargets.length; index += 1) {
      const target = relTargets[index];
      expect(target.name).toEqual(expect.stringContaining('Spear phishing'));
    }
  });
  it('should list relations start time', async () => {
    // Uses relations first seen
    // 0 = "2020-02-29T23:00:00.000Z" | 1 = "2020-02-29T23:00:00.000Z" | 2 = "2020-02-28T23:00:00.000Z"
    const options = { startTimeStart: '2020-02-29T22:00:00.000Z', stopTimeStop: '2020-02-29T23:30:00.000Z' };
    const stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(2);
  });
  it('should list relations stop time', async () => {
    // Uses relations last seen
    // 0 = "2020-02-29T23:00:00.000Z" | 1 = "2020-02-29T23:00:00.000Z" | 2 = "2020-02-29T23:00:00.000Z"
    let options = { startTimeStart: '2020-02-29T23:00:00.000Z', stopTimeStop: '2020-02-29T23:00:00.000Z' };
    let stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(0);
    options = { startTimeStart: '2020-02-29T22:59:59.000Z', stopTimeStop: '2020-02-29T23:00:01.000Z' };
    stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(1);
  });
  it('should list relations with confidence', async () => {
    const options = { confidences: [20] };
    const stixRelations = await listRelations(ADMIN_USER, 'indicates', options);
    expect(stixRelations.edges.length).toEqual(2);
  });
  it.skip('should list relations with filters', async () => {
    let filters = [{ key: 'connections', nested: [{ key: 'name', values: ['malicious'], operator: 'wildcard' }] }];
    const malware = await elLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    let options = { fromId: malware.internal_id, filters };
    let stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(1);
    const relation = R.head(stixRelations.edges).node;
    const target = await elLoadById(ADMIN_USER, relation.toId);
    expect(target.name).toEqual(expect.stringContaining('malicious'));
    // Test with exact match
    filters = [{ key: 'connections', nested: [{ key: 'name', values: ['malicious'] }] }];
    options = { fromId: malware.internal_id, filters };
    stixRelations = await listRelations(ADMIN_USER, 'uses', options);
    expect(stixRelations.edges.length).toEqual(0);
  });
  it('should list sightings', async () => {
    const stixSightings = await listRelations(ADMIN_USER, 'stix-sighting-relationship');
    expect(stixSightings).not.toBeNull();
    expect(stixSightings.edges.length).toEqual(3);
  });
  it('should list sightings with id option', async () => {
    // Just id specified,
    // "name": "Paradise Ransomware"
    const relationship = await elLoadById(ADMIN_USER, 'relationship--8d2200a8-f9ef-4345-95d1-ba3ed49606f9');
    const options = { fromId: relationship.internal_id };
    const thing = await internalLoadById(ADMIN_USER, relationship.internal_id);
    const stixSightings = await listRelations(ADMIN_USER, 'stix-sighting-relationship', options);
    for (let index = 0; index < stixSightings.edges.length; index += 1) {
      const stixSighting = stixSightings.edges[index].node;
      expect(stixSighting.fromId).toEqual(thing.grakn_id);
    }
  });
});

describe('Element loader', () => {
  it('should load entity by id - internal', async () => {
    // No type
    const report = await elLoadById(ADMIN_USER, 'report--a445d22a-db0c-4b5d-9ec8-e9ad0b6dbdd7');
    const internalId = report.internal_id;
    let element = await internalLoadById(ADMIN_USER, internalId);
    expect(element).not.toBeNull();
    expect(element.id).toEqual(internalId);
    expect(element.name).toEqual('A demo report for testing purposes');
    // Correct type
    element = await loadById(ADMIN_USER, internalId, ENTITY_TYPE_CONTAINER_REPORT);
    expect(element).not.toBeNull();
    expect(element.id).toEqual(internalId);
    // Wrong type
    element = await loadById(ADMIN_USER, internalId, ENTITY_TYPE_CONTAINER_OBSERVED_DATA);
    expect(element).toBeUndefined();
  });
  it('should load entity by id', async () => {
    // No type
    const report = await elLoadById(ADMIN_USER, 'report--a445d22a-db0c-4b5d-9ec8-e9ad0b6dbdd7');
    const internalId = report.internal_id;
    const loadPromise = loadById(ADMIN_USER, internalId);
    expect(loadPromise).rejects.toThrow();
    const element = await loadById(ADMIN_USER, internalId, ENTITY_TYPE_CONTAINER_REPORT);
    expect(element).not.toBeNull();
    expect(element.id).toEqual(internalId);
    expect(element.name).toEqual('A demo report for testing purposes');
  });
  it('should load entity by stix id', async () => {
    // No type
    const stixId = 'report--a445d22a-db0c-4b5d-9ec8-e9ad0b6dbdd7';
    const loadPromise = loadById(ADMIN_USER, stixId);
    expect(loadPromise).rejects.toThrow();
    const element = await loadById(ADMIN_USER, stixId, ENTITY_TYPE_CONTAINER_REPORT);
    expect(element).not.toBeNull();
    expect(element.standard_id).toEqual('report--f3e554eb-60f5-587c-9191-4f25e9ba9f32');
    expect(element.name).toEqual('A demo report for testing purposes');
  });
  it('should load relation by id', async () => {
    // No type
    const relation = await elLoadById(ADMIN_USER, 'relationship--e35b3fc1-47f3-4ccb-a8fe-65a0864edd02');
    const relationId = relation.internal_id;
    const loadPromise = loadById(ADMIN_USER, relationId, null);
    expect(loadPromise).rejects.toThrow();
    const element = await loadById(ADMIN_USER, relationId, 'uses');
    expect(element).not.toBeNull();
    expect(element.id).toEqual(relationId);
    expect(element.confidence).toEqual(3);
  });
  it('should load relation by stix id', async () => {
    const stixId = 'relationship--e35b3fc1-47f3-4ccb-a8fe-65a0864edd02';
    const loadPromise = loadById(ADMIN_USER, stixId, null);
    expect(loadPromise).rejects.toThrow();
    const element = await loadById(ADMIN_USER, stixId, 'uses');
    expect(element).not.toBeNull();
    expect(element.x_opencti_stix_ids).toEqual([stixId]);
    expect(element.confidence).toEqual(3);
  });
  it('should load by grakn id for multiple attributes', async () => {
    const stixId = 'identity--72de07e8-e6ed-4dfe-b906-1e82fae1d132';
    const identity = await loadById(ADMIN_USER, stixId, ENTITY_TYPE_IDENTITY_ORGANIZATION);
    expect(identity).not.toBeNull();
    expect(identity.x_opencti_aliases).not.toBeNull();
    expect(identity.x_opencti_aliases.length).toEqual(2);
    expect(identity.x_opencti_aliases.includes('Computer Incident')).toBeTruthy();
    expect(identity.x_opencti_aliases.includes('Incident')).toBeTruthy();
  });
});

describe('Attribute updated and indexed correctly', () => {
  it('should entity report attribute updated', async () => {
    const entityTypes = await findAllAttributes(ADMIN_USER, { type: 'report_types' });
    expect(entityTypes).not.toBeNull();
    expect(entityTypes.edges.length).toEqual(2);
    const typeMap = new Map(entityTypes.edges.map((i) => [i.node.value, i]));
    const threatReportAttribute = typeMap.get('threat-report');
    expect(threatReportAttribute).not.toBeUndefined();
    const attributeId = threatReportAttribute.node.id;
    // 01. Get the report directly and test if type is "Threat report".
    const stixId = 'report--a445d22a-db0c-4b5d-9ec8-e9ad0b6dbdd7';
    let report = await loadById(ADMIN_USER, stixId, ENTITY_TYPE_CONTAINER_REPORT);
    expect(report).not.toBeNull();
    expect(report.report_types).toEqual(['threat-report']);
    // 02. Update attribute "Threat report" to "Threat test"
    let updatedAttribute = await attributeEditField(SYSTEM_USER, attributeId, [
      {
        key: 'value',
        value: ['threat-test'],
      },
    ]);
    expect(updatedAttribute).not.toBeNull();
    // Wait a bit for elastic refresh
    await sleep(2000);
    // 03. Get the report directly and test if type is Threat test
    report = await loadById(ADMIN_USER, stixId, ENTITY_TYPE_CONTAINER_REPORT);
    expect(report).not.toBeNull();
    expect(report.report_types).toEqual(['threat-test']);
    // 04. Back to original configuration
    updatedAttribute = await attributeEditField(SYSTEM_USER, attributeId, [
      {
        key: 'value',
        value: ['threat-report'],
      },
    ]);
    expect(updatedAttribute).not.toBeNull();
    // Wait a bit for elastic refresh
    await sleep(2000);
    report = await loadById(ADMIN_USER, stixId, ENTITY_TYPE_CONTAINER_REPORT);
    expect(report).not.toBeNull();
    expect(report.report_types).toEqual(['threat-report']);
  });
});

describe('Entities time series', () => {
  it('should published entity time series', async () => {
    // const { startDate, endDate, operation, field, interval, inferred = false } = options;
    const options = {
      field: 'published',
      operation: 'count',
      interval: 'month',
      startDate: '2019-09-23T00:00:00.000+01:00',
      endDate: '2020-04-04T00:00:00.000+01:00',
    };
    const series = await timeSeriesEntities(ADMIN_USER, 'Stix-Domain-Object', [], options);
    expect(series.length).toEqual(8);
    const aggregationMap = new Map(series.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2020-02-29T23:00:00.000Z')).toEqual(1);
  });
  it('should start time relation time series', async () => {
    // const { startDate, endDate, operation, field, interval, inferred = false } = options;
    const intrusionSet = await elLoadById(ADMIN_USER, 'intrusion-set--18854f55-ac7c-4634-bd9a-352dd07613b7');
    const filters = [{ isRelation: true, type: 'attributed-to', value: intrusionSet.internal_id }];
    const options = {
      field: 'first_seen',
      operation: 'count',
      interval: 'month',
      startDate: '2020-01-01T00:00:00+01:00',
      endDate: '2021-01-01T00:00:00+01:00',
    };
    const series = await timeSeriesEntities(ADMIN_USER, 'Campaign', filters, options);
    expect(series.length).toEqual(13);
    const aggregationMap = new Map(series.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2020-01-31T23:00:00.000Z')).toEqual(1);
  });
  it('should local filter time series', async () => {
    // const { startDate, endDate, operation, field, interval, inferred = false } = options;
    const filters = [{ type: 'name', value: 'A new campaign' }];
    const options = {
      field: 'first_seen',
      operation: 'count',
      interval: 'month',
      startDate: '2020-01-01T00:00:00+01:00',
      endDate: '2020-10-01T00:00:00+02:00',
    };
    const series = await timeSeriesEntities(ADMIN_USER, 'Stix-Domain-Object', filters, options);
    expect(series.length).toEqual(10);
    const aggregationMap = new Map(series.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2020-01-31T23:00:00.000Z')).toEqual(1);
  });
});

describe('Relations time series', () => {
  // const { startDate, endDate, operation, relationship_type, field, interval, fromId, inferred = false } = options;

  it('should relations first seen time series', async () => {
    // relationship--e35b3fc1-47f3-4ccb-a8fe-65a0864edd02 > 2020-02-29T23:00:00.000Z
    // relationship--1fc9b5f8-3822-44c5-85d9-ee3476ca26de > 2020-02-29T23:00:00.000Z
    // relationship--9f999fc5-5c74-4964-ab87-ee4c7cdc37a3 > 2020-02-28T23:00:00.000Z
    const options = {
      relationship_type: 'uses',
      field: 'start_time',
      operation: 'count',
      interval: 'month',
      startDate: '2019-09-23T00:00:00.000+01:00',
      endDate: '2020-04-04T00:00:00.000+01:00',
    };
    const series = await timeSeriesRelations(ADMIN_USER, options);
    expect(series.length).toEqual(8);
    const aggregationMap = new Map(series.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2020-01-31T23:00:00.000Z')).toEqual(3);
  });
  it('should relations with fromId time series', async () => {
    const malware = await elLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const options = {
      fromId: malware.internal_id,
      relationship_type: 'uses',
      field: 'start_time',
      operation: 'count',
      interval: 'year',
      startDate: '2018-09-23T00:00:00.000+01:00',
      endDate: '2020-06-04T00:00:00.000+01:00',
    };
    const series = await timeSeriesRelations(ADMIN_USER, options);
    expect(series.length).toEqual(3);
    const aggregationMap = new Map(series.map((i) => [i.date, i.value]));
    expect(aggregationMap.get('2019-12-31T23:00:00.000Z')).toEqual(3);
  });
});

describe('Entities distribution', () => {
  it('should entity distribution', async () => {
    // const { startDate, endDate, operation, field, inferred } = options;
    const options = { field: 'entity_type', operation: 'count', limit: 20 };
    const distribution = await distributionEntities(ADMIN_USER, 'Stix-Domain-Object', [], options);
    expect(distribution.length).toEqual(17);
    const aggregationMap = new Map(distribution.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Malware')).toEqual(2);
    expect(aggregationMap.get('Campaign')).toEqual(1);
  });
  it.skip('should entity distribution filters', async () => {
    // const { startDate, endDate, operation, field, inferred } = options;
    const malware = await elLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const options = { field: 'entity_type', operation: 'count', limit: 20 };
    const start = '2020-02-28T22:59:00.000Z';
    const end = '2020-02-28T23:01:00.000Z';
    const relationFilter = {
      isRelation: true,
      type: 'uses',
      from: 'uses_from',
      to: 'uses_to',
      value: malware.internal_id,
      start,
      end,
    };
    const filters = [relationFilter];
    const distribution = await distributionEntities(ADMIN_USER, 'Stix-Domain-Object', filters, options);
    expect(distribution.length).toEqual(1);
    const aggregationMap = new Map(distribution.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Intrusion-Set')).toEqual(1);
  });
  it('should entity distribution with date filtering', async () => {
    // const { startDate, endDate, operation, field, inferred } = options;
    const options = {
      field: 'entity_type',
      operation: 'count',
      limit: 20,
      startDate: '2018-03-01T00:00:00+01:00',
      endDate: '2018-03-02T00:00:00+01:00',
    };
    const distribution = await distributionEntities(ADMIN_USER, 'Stix-Domain-Object', [], options);
    expect(distribution.length).toEqual(0);
  });
});

describe('Relations distribution', () => {
  // Malware Paradise Ransomware
  // --> attack-pattern--489a7797-01c3-4706-8cd1-ec56a9db3adc
  // ----------- relationship--e35b3fc1-47f3-4ccb-a8fe-65a0864edd02 > first_seen: 2020-02-29T23:00:00.000Z,
  // --> attack-pattern--2fc04aa5-48c1-49ec-919a-b88241ef1d17
  // ----------- relationship--1fc9b5f8-3822-44c5-85d9-ee3476ca26de > first_seen: 2020-02-29T23:00:00.000Z
  // <-- intrusion-set--18854f55-ac7c-4634-bd9a-352dd07613b7
  // ----------- relationship--9f999fc5-5c74-4964-ab87-ee4c7cdc37a3 > first_seen: 2020-02-28T23:00:00.000Z

  it('should relation distribution', async () => {
    // const { limit = 50, order, inferred = false } = options;
    // const { startDate, endDate, relationship_type, toTypes, fromId, field, operation } = options;
    const malware = await elLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const options = {
      fromId: malware.internal_id,
      relationship_type: 'uses',
      field: 'entity_type',
      operation: 'count',
    };
    const distribution = await distributionRelations(ADMIN_USER, options);
    expect(distribution.length).toEqual(2);
    const aggregationMap = new Map(distribution.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Attack-Pattern')).toEqual(2);
    expect(aggregationMap.get('Intrusion-Set')).toEqual(1);
  });
  it('should relation distribution dates filtered', async () => {
    const malware = await elLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const options = {
      fromId: malware.internal_id,
      field: 'entity_type',
      operation: 'count',
      startDate: '2020-02-28T22:59:00.000Z',
      endDate: '2020-02-28T23:01:00.000Z',
    };
    const distribution = await distributionRelations(ADMIN_USER, options);
    expect(distribution.length).toEqual(0);
    const aggregationMap = new Map(distribution.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Intrusion-Set')).toEqual(undefined);
  });
  it('should relation distribution filtered by to', async () => {
    const malware = await elLoadById(ADMIN_USER, 'malware--faa5b705-cf44-4e50-8472-29e5fec43c3c');
    const options = {
      fromId: malware.internal_id,
      field: 'entity_type',
      operation: 'count',
      toTypes: ['Attack-Pattern'],
    };
    const distribution = await distributionRelations(ADMIN_USER, options);
    expect(distribution.length).toEqual(1);
    const aggregationMap = new Map(distribution.map((i) => [i.label, i.value]));
    expect(aggregationMap.get('Attack-Pattern')).toEqual(2);
  });
});

// Some utils
const createThreat = async (input) => {
  const threat = await createEntity(ADMIN_USER, input, ENTITY_TYPE_THREAT_ACTOR);
  return loadById(ADMIN_USER, threat.id, ENTITY_TYPE_THREAT_ACTOR);
};
const createFile = async (input) => {
  const observableSyntaxResult = checkObservableSyntax(ENTITY_HASHED_OBSERVABLE_STIX_FILE, input);
  if (observableSyntaxResult !== true) {
    throw FunctionalError(`Observable of type ${ENTITY_HASHED_OBSERVABLE_STIX_FILE} is not correctly formatted.`);
  }
  const file = await createEntity(ADMIN_USER, input, ENTITY_HASHED_OBSERVABLE_STIX_FILE);
  return loadById(ADMIN_USER, file.id, ENTITY_HASHED_OBSERVABLE_STIX_FILE);
};
const isOneOfThisIdsExists = async (ids) => {
  const idsShould = ids.map((id) => ({ match_phrase: { 'internal_id.keyword': id } }));
  const connectionsShould = ids.map((id) => ({ match_phrase: { 'connections.internal_id.keyword': id } }));
  const relsShould = ids.map((id) => ({ multi_match: { query: id, type: 'phrase', fields: ['rel_*'] } }));
  const nestedConnections = {
    nested: {
      path: 'connections',
      query: {
        bool: {
          should: connectionsShould,
          minimum_should_match: 1,
        },
      },
    },
  };
  const query = {
    index: READ_DATA_INDICES,
    ignore_throttled: ES_IGNORE_THROTTLED,
    size: 5000,
    body: {
      query: {
        bool: {
          should: [...idsShould, ...relsShould, nestedConnections],
          minimum_should_match: 1,
        },
      },
    },
  };
  const looking = await el.search(query);
  const numberOfResult = looking.body.hits.total.value;
  return numberOfResult > 0;
};

const MD5 = '0a330361c8475ca475cbb5678643789b';
const SHA1 = '4e6441ffd23006dc3be69e28ddc1978c3da2e7cd';
const SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('Upsert and merge entities', () => {
  const testMarking = 'marking-definition--78ca4366-f5b8-4764-83f7-34ce38198e27';
  const whiteMarking = 'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9';
  const mitreMarking = 'marking-definition--fa42a846-8d90-4e51-bc29-71d5b4802168';
  it('should entity upserted', async () => {
    // Most simple entity
    const malware = {
      name: 'MALWARE_TEST',
      description: 'MALWARE_TEST DESCRIPTION',
      objectMarking: [whiteMarking, mitreMarking],
    };
    const createdMalware = await createEntity(ADMIN_USER, malware, ENTITY_TYPE_MALWARE);
    expect(createdMalware).not.toBeNull();
    expect(createdMalware.name).toEqual('MALWARE_TEST');
    expect(createdMalware.description).toEqual('MALWARE_TEST DESCRIPTION');
    expect(createdMalware.i_aliases_ids.length).toEqual(1); // We put the name as internal alias id
    let loadMalware = await loadById(ADMIN_USER, createdMalware.id, ENTITY_TYPE_MALWARE);
    expect(loadMalware).not.toBeNull();
    expect(loadMalware.object_marking_refs.length).toEqual(2);
    // Upsert TLP by name
    let upMalware = { name: 'MALWARE_TEST', objectMarking: [testMarking] };
    let upsertedMalware = await createEntity(ADMIN_USER, upMalware, ENTITY_TYPE_MALWARE);
    expect(upsertedMalware).not.toBeNull();
    expect(upsertedMalware.id).toEqual(createdMalware.id);
    expect(upsertedMalware.name).toEqual('MALWARE_TEST');
    loadMalware = await loadById(ADMIN_USER, createdMalware.id, ENTITY_TYPE_MALWARE);
    expect(loadMalware.object_marking_refs.length).toEqual(3);
    // Upsert definition per alias
    upMalware = {
      name: 'NEW NAME',
      description: 'MALWARE_TEST NEW',
      stix_id: 'malware--907bb632-e3c2-52fa-b484-cf166a7d377e',
      update: true,
      aliases: ['MALWARE_TEST'],
    };
    upsertedMalware = await createEntity(ADMIN_USER, upMalware, ENTITY_TYPE_MALWARE);
    expect(upsertedMalware.name).toEqual('NEW NAME');
    expect(upsertedMalware.description).toEqual('MALWARE_TEST NEW');
    expect(upsertedMalware.id).toEqual(createdMalware.id);
    expect(upsertedMalware.x_opencti_stix_ids).toEqual(['malware--907bb632-e3c2-52fa-b484-cf166a7d377e']);
    expect(upsertedMalware.aliases.sort()).toEqual(['NEW NAME', 'MALWARE_TEST'].sort());
    loadMalware = await loadById(ADMIN_USER, createdMalware.id, ENTITY_TYPE_MALWARE);
    expect(loadMalware.name).toEqual('NEW NAME');
    expect(loadMalware.description).toEqual('MALWARE_TEST NEW');
    expect(loadMalware.id).toEqual(loadMalware.id);
    expect(loadMalware.x_opencti_stix_ids).toEqual(['malware--907bb632-e3c2-52fa-b484-cf166a7d377e']);
    expect(loadMalware.aliases.sort()).toEqual(['NEW NAME', 'MALWARE_TEST'].sort());
    // Delete the markings
    const white = await internalLoadById(ADMIN_USER, whiteMarking);
    await deleteRelationsByFromAndTo(
      ADMIN_USER,
      loadMalware.internal_id,
      white.internal_id,
      RELATION_OBJECT_MARKING,
      ABSTRACT_STIX_META_RELATIONSHIP
    );
    const checkers = await elFindByIds(ADMIN_USER, loadMalware.id);
    const test = await internalLoadById(ADMIN_USER, testMarking);
    const mitre = await internalLoadById(ADMIN_USER, mitreMarking);
    const rawMarkings = R.head(checkers).object_marking_refs;
    expect(rawMarkings.length).toEqual(2);
    expect(rawMarkings.includes(test.internal_id)).toBeTruthy();
    expect(rawMarkings.includes(mitre.internal_id)).toBeTruthy();
    // Delete the malware
    await deleteElementById(ADMIN_USER, createdMalware.id, ENTITY_TYPE_MALWARE);
  });
  it('should entity merged', async () => {
    // 01. Create malware
    const malware01 = await createEntity(ADMIN_USER, { name: 'MALWARE_TEST_01' }, ENTITY_TYPE_MALWARE);
    const malware02 = await createEntity(ADMIN_USER, { name: 'MALWARE_TEST_02' }, ENTITY_TYPE_MALWARE);
    const malware03 = await createEntity(ADMIN_USER, { name: 'MALWARE_TEST_03' }, ENTITY_TYPE_MALWARE);
    // 02. Create threat actors
    // target
    const targetInput01 = {
      name: 'THREAT_MERGE',
      description: 'DESC',
      objectMarking: [testMarking],
      objectLabel: ['identity', 'malware'],
    };
    let target = await createThreat(targetInput01);
    await createRelation(ADMIN_USER, {
      fromId: target.internal_id,
      toId: malware01.internal_id,
      relationship_type: RELATION_USES,
    });
    target = await loadById(ADMIN_USER, target.id, ENTITY_TYPE_THREAT_ACTOR);
    // source 01
    const sourceInput01 = {
      name: 'THREAT_SOURCE_01',
      goals: ['MY GOAL'],
      objectMarking: [whiteMarking, mitreMarking],
      objectLabel: ['report', 'opinion', 'malware'],
    };
    const source01 = await createThreat(sourceInput01);
    // source 02
    const sourceInput02 = {
      name: 'THREAT_SOURCE_02',
      objectMarking: [testMarking, whiteMarking, mitreMarking],
      objectLabel: ['report', 'note', 'malware'],
    };
    let source02 = await createThreat(sourceInput02);
    await createRelation(ADMIN_USER, {
      fromId: source02.internal_id,
      toId: malware02.internal_id,
      relationship_type: RELATION_USES,
      objectMarking: [testMarking, whiteMarking, mitreMarking],
      objectLabel: ['report', 'note', 'malware'],
    });
    source02 = await loadById(ADMIN_USER, source02.id, ENTITY_TYPE_THREAT_ACTOR);
    // source 03
    const sourceInput03 = { name: 'THREAT_SOURCE_03', objectMarking: [testMarking], objectLabel: ['note', 'malware'] };
    let source03 = await createThreat(sourceInput03);
    const duplicateRel = await createRelation(ADMIN_USER, {
      fromId: source03.internal_id,
      toId: malware02.internal_id,
      relationship_type: RELATION_USES,
      objectMarking: [testMarking, whiteMarking, mitreMarking],
      objectLabel: ['report', 'note', 'malware'],
    });
    source03 = await loadById(ADMIN_USER, source03.id, ENTITY_TYPE_THREAT_ACTOR);
    // source 04
    const sourceInput04 = {
      name: 'THREAT_SOURCE_04',
      objectMarking: [whiteMarking],
      objectLabel: ['report', 'opinion', 'note', 'malware', 'identity'],
    };
    const source04 = await createThreat(sourceInput04);
    // source 05
    const sourceInput05 = { name: 'THREAT_SOURCE_05' };
    const source05 = await createThreat(sourceInput05);
    // source 06
    const sourceInput06 = { name: 'THREAT_SOURCE_06', objectMarking: [testMarking, whiteMarking, mitreMarking] };
    let source06 = await createThreat(sourceInput06);
    await createRelation(ADMIN_USER, {
      fromId: source06.internal_id,
      toId: malware03.internal_id,
      relationship_type: RELATION_USES,
    });
    source06 = await loadById(ADMIN_USER, source06.id, ENTITY_TYPE_THREAT_ACTOR);
    // Merge with fully resolved entities
    const merged = await mergeEntities(ADMIN_USER, target.internal_id, [
      source01.internal_id,
      source02.internal_id,
      source03.internal_id,
      source04.internal_id,
      source05.internal_id,
      source06.internal_id,
    ]);
    const loadedThreat = await fullLoadById(ADMIN_USER, merged.id, ENTITY_TYPE_THREAT_ACTOR);
    // List of ids that should disappears
    const idsThatShouldNotExists = [
      source01.internal_id,
      source02.internal_id,
      source03.internal_id,
      source04.internal_id,
      source05.internal_id,
      source06.internal_id,
      duplicateRel.internal_id,
    ];
    const isExist = await isOneOfThisIdsExists(idsThatShouldNotExists);
    expect(isExist).toBeFalsy();
    // Test the merged data
    expect(loadedThreat).not.toBeNull();
    expect(loadedThreat.aliases.length).toEqual(6); // [THREAT_SOURCE_01, THREAT_SOURCE_02, THREAT_SOURCE_03, THREAT_SOURCE_04, THREAT_SOURCE_05, THREAT_SOURCE_06]
    expect(loadedThreat.i_aliases_ids.length).toEqual(7);
    expect(loadedThreat.goals).toEqual(['MY GOAL']);
    expect(loadedThreat[INTERNAL_FROM_FIELD]['object-marking'].length).toEqual(3); // [testMarking, whiteMarking, mitreMarking]
    expect(loadedThreat[INTERNAL_FROM_FIELD]['object-label'].length).toEqual(5); // ['report', 'opinion', 'note', 'malware', 'identity']
    expect(loadedThreat[INTERNAL_FROM_FIELD].uses.length).toEqual(3); // [MALWARE_TEST_01, MALWARE_TEST_02, MALWARE_TEST_03]
    // Cleanup
    await deleteElementById(ADMIN_USER, malware01.id, ENTITY_TYPE_MALWARE);
    await deleteElementById(ADMIN_USER, malware02.id, ENTITY_TYPE_MALWARE);
    await deleteElementById(ADMIN_USER, malware03.id, ENTITY_TYPE_MALWARE);
    await deleteElementById(ADMIN_USER, loadedThreat.id, ENTITY_TYPE_THREAT_ACTOR);
  });
  it('should observable merged by update', async () => {
    // Merged 3 Stix File into one
    const md5 = await createFile({ hashes: { MD5 }, objectMarking: [whiteMarking] });
    const sha1 = await createFile({
      hashes: { 'SHA-1': SHA1 },
      objectMarking: [testMarking, whiteMarking, mitreMarking],
    });
    const sha256 = await createFile({
      hashes: { 'SHA-256': SHA256 },
      objectMarking: [testMarking, whiteMarking, mitreMarking],
    });
    // merge by update
    const md5Input = { key: 'hashes.MD5', value: [MD5] };
    // eslint-disable-next-line prettier/prettier
    const patchSha1 = updateAttribute(SYSTEM_USER, sha1.internal_id, ENTITY_HASHED_OBSERVABLE_STIX_FILE, [md5Input]);
    // eslint-disable-next-line prettier/prettier
    const patchSha256 = updateAttribute(SYSTEM_USER, sha256.internal_id, ENTITY_HASHED_OBSERVABLE_STIX_FILE, [md5Input]);
    await Promise.all([patchSha1, patchSha256]);
    // Check
    const idsThatShouldNotExists = [sha1.internal_id, sha256.internal_id];
    const isExist = await isOneOfThisIdsExists(idsThatShouldNotExists);
    expect(isExist).toBeFalsy();
    const reloadMd5 = await loadById(ADMIN_USER, md5.id, ENTITY_HASHED_OBSERVABLE_STIX_FILE);
    expect(reloadMd5).not.toBeNull();
    expect(reloadMd5.hashes).not.toBeNull();
    expect(reloadMd5.hashes.MD5).toEqual(MD5);
    expect(reloadMd5.hashes['SHA-1']).toEqual(SHA1);
    expect(reloadMd5.hashes['SHA-256']).toEqual(SHA256);
    expect(reloadMd5.object_marking_refs.length).toEqual(3); // [testMarking, whiteMarking, mitreMarking]
    // Cleanup
    await deleteElementById(ADMIN_USER, reloadMd5.id, ENTITY_HASHED_OBSERVABLE_STIX_FILE);
  });
});

describe('Elements impacts deletions', () => {
  // Intrusion Set    =>    uses      =>   Malware
  //      ^                  ^                ^
  //      |                  |                |
  //    Label  Label <-- indicates         Label
  //                         ^
  //                         |
  //                     Indicator
  it('should all elements correctly deleted', async () => {
    // Create entities
    const label = await addLabel(ADMIN_USER, { value: 'MY LABEL' });
    const intrusionSet = await createEntity(
      ADMIN_USER,
      { name: 'MY ISET', description: 'MY ISET' },
      ENTITY_TYPE_INTRUSION_SET
    );
    const malware = await createEntity(ADMIN_USER, { name: 'MY MAL', description: 'MY MAL' }, ENTITY_TYPE_MALWARE);
    const indicator = await createEntity(
      ADMIN_USER,
      { name: 'MY INDIC', pattern: 'pattern', pattern_type: 'pattern-type' },
      ENTITY_TYPE_INDICATOR
    );
    // Create basic relations
    // eslint-disable-next-line camelcase
    const intrusionSet_uses_Malware = await createRelation(ADMIN_USER, {
      fromId: intrusionSet.internal_id,
      toId: malware.internal_id,
      relationship_type: 'uses',
    });
    // eslint-disable-next-line camelcase
    const indicator_indicated_uses = await createRelation(ADMIN_USER, {
      fromId: indicator.internal_id,
      toId: intrusionSet_uses_Malware.internal_id,
      relationship_type: 'indicates',
    });
    // Create labels relations
    const intrusionSetLabel = await createRelation(ADMIN_USER, {
      fromId: intrusionSet.internal_id,
      toId: label.internal_id,
      relationship_type: 'object-label',
    });
    const relIndicatesLabel = await createRelation(ADMIN_USER, {
      fromId: indicator_indicated_uses.internal_id,
      toId: label.internal_id,
      relationship_type: 'object-label',
    });
    const malwareLabel = await createRelation(ADMIN_USER, {
      fromId: malware.internal_id,
      toId: label.internal_id,
      relationship_type: 'object-label',
    });
    // Delete the intrusion set, check all relation what need to be deleted
    const toBeDeleted = [
      intrusionSet.internal_id,
      intrusionSet_uses_Malware.internal_id,
      indicator_indicated_uses.internal_id,
      intrusionSetLabel.internal_id,
      relIndicatesLabel.internal_id,
    ];
    await deleteElementById(ADMIN_USER, intrusionSet.internal_id, ENTITY_TYPE_INTRUSION_SET);
    const isExist = await isOneOfThisIdsExists(toBeDeleted);
    expect(isExist).toBeFalsy();
    const resolvedMalware = await loadById(ADMIN_USER, malware.internal_id, ENTITY_TYPE_MALWARE);
    expect(resolvedMalware).not.toBeUndefined();
    const resolvedRelationLabel = await loadById(ADMIN_USER, malwareLabel.internal_id, RELATION_OBJECT_LABEL);
    expect(resolvedRelationLabel).not.toBeUndefined();
    // Clear remaining stuff
    await deleteElementById(ADMIN_USER, resolvedMalware.internal_id, ENTITY_TYPE_MALWARE);
    await deleteElementById(ADMIN_USER, indicator.internal_id, ENTITY_TYPE_INDICATOR);
    await deleteElementById(ADMIN_USER, label.internal_id, ENTITY_TYPE_LABEL);
  });
});
