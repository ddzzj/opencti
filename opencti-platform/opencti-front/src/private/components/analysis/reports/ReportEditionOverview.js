import React, { Component } from 'react';
import * as PropTypes from 'prop-types';
import graphql from 'babel-plugin-relay/macro';
import { createFragmentContainer } from 'react-relay';
import { Formik, Field, Form } from 'formik';
import { withStyles } from '@material-ui/core/styles';
import MenuItem from '@material-ui/core/MenuItem';
import {
  assoc,
  compose,
  map,
  pathOr,
  pipe,
  pick,
  difference,
  head,
} from 'ramda';
import * as Yup from 'yup';
import { dateFormat } from '../../../../utils/Time';
import { QueryRenderer, commitMutation } from '../../../../relay/environment';
import inject18n from '../../../../components/i18n';
import TextField from '../../../../components/TextField';
import SelectField from '../../../../components/SelectField';
import { SubscriptionFocus } from '../../../../components/Subscription';
import DatePickerField from '../../../../components/DatePickerField';
import { attributesQuery } from '../../settings/attributes/AttributesLines';
import Loader from '../../../../components/Loader';
import CreatedByField from '../../common/form/CreatedByField';
import ObjectMarkingField from '../../common/form/ObjectMarkingField';
import ConfidenceField from '../../common/form/ConfidenceField';
import MarkDownField from '../../../../components/MarkDownField';
import StatusField from '../../common/form/StatusField';

const styles = () => ({
  createButton: {
    position: 'fixed',
    bottom: 30,
    right: 30,
  },
  importButton: {
    position: 'absolute',
    top: 30,
    right: 30,
  },
});

export const reportMutationFieldPatch = graphql`
  mutation ReportEditionOverviewFieldPatchMutation(
    $id: ID!
    $input: [EditInput]!
  ) {
    reportEdit(id: $id) {
      fieldPatch(input: $input) {
        x_opencti_graph_data
        ...ReportEditionOverview_report
        ...Report_report
      }
    }
  }
`;

export const reportEditionOverviewFocus = graphql`
  mutation ReportEditionOverviewFocusMutation($id: ID!, $input: EditContext!) {
    reportEdit(id: $id) {
      contextPatch(input: $input) {
        id
      }
    }
  }
`;

const reportMutationRelationAdd = graphql`
  mutation ReportEditionOverviewRelationAddMutation(
    $id: ID!
    $input: StixMetaRelationshipAddInput
  ) {
    reportEdit(id: $id) {
      relationAdd(input: $input) {
        from {
          ...ReportEditionOverview_report
        }
      }
    }
  }
`;

const reportMutationRelationDelete = graphql`
  mutation ReportEditionOverviewRelationDeleteMutation(
    $id: ID!
    $toId: String!
    $relationship_type: String!
  ) {
    reportEdit(id: $id) {
      relationDelete(toId: $toId, relationship_type: $relationship_type) {
        ...ReportEditionOverview_report
      }
    }
  }
`;

const reportValidation = (t) => Yup.object().shape({
  name: Yup.string().required(t('This field is required')),
  published: Yup.date()
    .typeError(t('The value must be a date (YYYY-MM-DD)'))
    .required(t('This field is required')),
  report_types: Yup.array().required(t('This field is required')),
  description: Yup.string(),
  confidence: Yup.number(),
  status_id: Yup.object(),
});

class ReportEditionOverviewComponent extends Component {
  handleChangeFocus(name) {
    commitMutation({
      mutation: reportEditionOverviewFocus,
      variables: {
        id: this.props.report.id,
        input: {
          focusOn: name,
        },
      },
    });
  }

  handleSubmitField(name, value) {
    let finalValue = value;
    if (name === 'status_id') {
      finalValue = value.value;
    }
    reportValidation(this.props.t)
      .validateAt(name, { [name]: value })
      .then(() => {
        commitMutation({
          mutation: reportMutationFieldPatch,
          variables: {
            id: this.props.report.id,
            input: { key: name, value: finalValue },
          },
        });
      })
      .catch(() => false);
  }

  handleChangeCreatedBy(name, value) {
    if (!this.props.enableReferences) {
      commitMutation({
        mutation: reportMutationFieldPatch,
        variables: {
          id: this.props.report.id,
          input: { key: 'createdBy', value: value.value },
        },
      });
    }
  }

  handleChangeObjectMarking(name, values) {
    const { report } = this.props;
    const currentMarkingDefinitions = pipe(
      pathOr([], ['objectMarking', 'edges']),
      map((n) => ({
        label: n.node.definition,
        value: n.node.id,
      })),
    )(report);

    const added = difference(values, currentMarkingDefinitions);
    const removed = difference(currentMarkingDefinitions, values);

    if (added.length > 0) {
      commitMutation({
        mutation: reportMutationRelationAdd,
        variables: {
          id: this.props.report.id,
          input: {
            toId: head(added).value,
            relationship_type: 'object-marking',
          },
        },
      });
    }

    if (removed.length > 0) {
      commitMutation({
        mutation: reportMutationRelationDelete,
        variables: {
          id: this.props.report.id,
          toId: head(removed).value,
          relationship_type: 'object-marking',
        },
      });
    }
  }

  render() {
    const { t, report, context } = this.props;
    const createdBy = pathOr(null, ['createdBy', 'name'], report) === null
      ? ''
      : {
        label: pathOr(null, ['createdBy', 'name'], report),
        value: pathOr(null, ['createdBy', 'id'], report),
      };
    const objectMarking = pipe(
      pathOr([], ['objectMarking', 'edges']),
      map((n) => ({
        label: n.node.definition,
        value: n.node.id,
      })),
    )(report);
    const status = pathOr(null, ['status', 'template', 'name'], report) === null
      ? ''
      : {
        label: t(
          `status_${pathOr(null, ['status', 'template', 'name'], report)}`,
        ),
        color: pathOr(null, ['status', 'template', 'color'], report),
        value: pathOr(null, ['status', 'id'], report),
        order: pathOr(null, ['status', 'order'], report),
      };
    const initialValues = pipe(
      assoc('createdBy', createdBy),
      assoc('objectMarking', objectMarking),
      assoc('published', dateFormat(report.published)),
      assoc('status_id', status),
      pick([
        'name',
        'published',
        'description',
        'report_types',
        'createdBy',
        'objectMarking',
        'confidence',
        'status_id',
      ]),
    )(report);
    return (
      <div>
        <QueryRenderer
          query={attributesQuery}
          variables={{ key: 'report_types' }}
          render={({ props }) => {
            if (props && props.attributes) {
              const reportTypesEdges = props.attributes.edges;
              return (
                <Formik
                  enableReinitialize={true}
                  initialValues={initialValues}
                  validationSchema={reportValidation(t)}
                >
                  {({ setFieldValue }) => (
                    <div>
                      <Form style={{ margin: '20px 0 20px 0' }}>
                        <Field
                          component={TextField}
                          name="name"
                          label={t('Name')}
                          fullWidth={true}
                          onFocus={this.handleChangeFocus.bind(this)}
                          onSubmit={this.handleSubmitField.bind(this)}
                          helperText={
                            <SubscriptionFocus
                              context={context}
                              fieldName="name"
                            />
                          }
                        />
                        <Field
                          component={SelectField}
                          name="report_types"
                          onFocus={this.handleChangeFocus.bind(this)}
                          onChange={this.handleSubmitField.bind(this)}
                          label={t('Report types')}
                          fullWidth={true}
                          multiple={true}
                          containerstyle={{ marginTop: 20, width: '100%' }}
                          helpertext={
                            <SubscriptionFocus
                              context={context}
                              fieldName="report_types"
                            />
                          }
                        >
                          {reportTypesEdges.map((reportTypeEdge) => (
                            <MenuItem
                              key={reportTypeEdge.node.value}
                              value={reportTypeEdge.node.value}
                            >
                              {reportTypeEdge.node.value}
                            </MenuItem>
                          ))}
                        </Field>
                        <ConfidenceField
                          name="confidence"
                          onFocus={this.handleChangeFocus.bind(this)}
                          onChange={this.handleSubmitField.bind(this)}
                          label={t('Confidence')}
                          fullWidth={true}
                          containerstyle={{ width: '100%', marginTop: 20 }}
                          editContext={context}
                          variant="edit"
                        />
                        <Field
                          component={DatePickerField}
                          name="published"
                          label={t('Publication date')}
                          invalidDateMessage={t(
                            'The value must be a date (YYYY-MM-DD)',
                          )}
                          fullWidth={true}
                          style={{ marginTop: 20 }}
                          onFocus={this.handleChangeFocus.bind(this)}
                          onSubmit={this.handleSubmitField.bind(this)}
                          helperText={
                            <SubscriptionFocus
                              context={context}
                              fieldName="published"
                            />
                          }
                        />
                        <Field
                          component={MarkDownField}
                          name="description"
                          label={t('Description')}
                          fullWidth={true}
                          multiline={true}
                          rows="4"
                          style={{ marginTop: 20 }}
                          onFocus={this.handleChangeFocus.bind(this)}
                          onSubmit={this.handleSubmitField.bind(this)}
                        />
                        {report.workflowEnabled && (
                          <StatusField
                            name="status_id"
                            type="Report"
                            onFocus={this.handleChangeFocus.bind(this)}
                            onChange={this.handleSubmitField.bind(this)}
                            setFieldValue={setFieldValue}
                            style={{ marginTop: 20 }}
                            helpertext={
                              <SubscriptionFocus
                                context={context}
                                fieldName="status_id"
                              />
                            }
                          />
                        )}
                        <CreatedByField
                          name="createdBy"
                          style={{ marginTop: 20, width: '100%' }}
                          setFieldValue={setFieldValue}
                          helpertext={
                            <SubscriptionFocus
                              context={context}
                              fieldName="createdBy"
                            />
                          }
                          onChange={this.handleChangeCreatedBy.bind(this)}
                        />
                        <ObjectMarkingField
                          name="objectMarking"
                          style={{ marginTop: 20, width: '100%' }}
                          helpertext={
                            <SubscriptionFocus
                              context={context}
                              fieldname="objectMarking"
                            />
                          }
                          onChange={this.handleChangeObjectMarking.bind(this)}
                        />
                      </Form>
                    </div>
                  )}
                </Formik>
              );
            }
            return <Loader variant="inElement" />;
          }}
        />
      </div>
    );
  }
}

ReportEditionOverviewComponent.propTypes = {
  classes: PropTypes.object,
  theme: PropTypes.object,
  t: PropTypes.func,
  report: PropTypes.object,
  context: PropTypes.array,
};

const ReportEditionOverview = createFragmentContainer(
  ReportEditionOverviewComponent,
  {
    report: graphql`
      fragment ReportEditionOverview_report on Report {
        id
        name
        description
        report_types
        published
        confidence
        createdBy {
          ... on Identity {
            id
            name
            entity_type
          }
        }
        objectMarking {
          edges {
            node {
              id
              definition
              definition_type
            }
          }
        }
        status {
          id
          order
          template {
            name
            color
          }
        }
        workflowEnabled
      }
    `,
  },
);

export default compose(
  inject18n,
  withStyles(styles, { withTheme: true }),
)(ReportEditionOverview);
