import React, { Component } from 'react';
import * as PropTypes from 'prop-types';
import { compose, pathOr } from 'ramda';
import graphql from 'babel-plugin-relay/macro';
import { withStyles } from '@material-ui/core/styles';
import { createPaginationContainer } from 'react-relay';
import Typography from '@material-ui/core/Typography';
import * as R from 'ramda';
import * as Yup from 'yup';
import { ConnectionHandler } from 'relay-runtime';
import IconButton from '@material-ui/core/IconButton';
import {
  EditOutlined,
  ExpandMoreOutlined,
  RateReviewOutlined,
} from '@material-ui/icons';
import Accordion from '@material-ui/core/Accordion';
import AccordionSummary from '@material-ui/core/AccordionSummary';
import AccordionDetails from '@material-ui/core/AccordionDetails';
import { Field, Form, Formik } from 'formik';
import Button from '@material-ui/core/Button';
import inject18n from '../../../../components/i18n';
import StixCoreObjectOrStixCoreRelationshipNoteCard from './StixCoreObjectOrStixCoreRelationshipNoteCard';
import Security, { KNOWLEDGE_KNUPDATE } from '../../../../utils/Security';
import AddNotes from './AddNotes';
import { commitMutation } from '../../../../relay/environment';
import { noteCreationMutation } from './NoteCreation';
import { noteLinesMutationRelationAdd } from './AddNotesLines';
import TextField from '../../../../components/TextField';
import MarkDownField from '../../../../components/MarkDownField';

const styles = (theme) => ({
  paper: {
    margin: 0,
    padding: '20px 20px 20px 20px',
    borderRadius: 6,
  },
  heading: {
    display: 'flex',
  },
  buttons: {
    marginTop: 20,
    textAlign: 'right',
  },
  button: {
    marginLeft: theme.spacing(2),
  },
  createButton: {
    float: 'left',
    marginTop: -15,
  },
});

const noteValidation = (t) => Yup.object().shape({
  attribute_abstract: Yup.string(),
  content: Yup.string().required(t('This field is required')),
});

const sharedUpdater = (store, entityId, newEdge) => {
  const entity = store.get(entityId);
  const conn = ConnectionHandler.getConnection(entity, 'Pagination_notes');
  ConnectionHandler.insertEdgeBefore(conn, newEdge);
};

class StixCoreRelationshipNotesCardsContainer extends Component {
  constructor(props) {
    super(props);
    this.bottomRef = React.createRef();
    this.state = { open: false };
  }

  scrollToBottom() {
    setTimeout(() => {
      this.bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }, 400);
  }

  handleToggleWrite() {
    const expanded = !this.state.open;
    this.setState({ open: expanded }, () => {
      if (expanded) {
        this.scrollToBottom();
      }
    });
  }

  onSubmit(values, { setSubmitting, resetForm }) {
    const { stixCoreRelationshipId, data } = this.props;
    const defaultMarking = R.pathOr(
      [],
      ['stixCoreRelationship', 'objectMarking', 'edges'],
      data,
    ).map((n) => n.node.id);
    const adaptedValues = R.pipe(R.assoc('objectMarking', defaultMarking))(
      values,
    );
    commitMutation({
      mutation: noteCreationMutation,
      variables: {
        input: adaptedValues,
      },
      setSubmitting,
      onCompleted: (response) => {
        const input = {
          toId: stixCoreRelationshipId,
          relationship_type: 'object',
        };
        commitMutation({
          mutation: noteLinesMutationRelationAdd,
          variables: {
            id: response.noteAdd.id,
            input,
          },
          updater: (store) => {
            const payload = store
              .getRootField('noteEdit')
              .getLinkedRecord('relationAdd', { input });
            const relationId = payload.getValue('id');
            const node = payload.getLinkedRecord('from');
            const relation = store.get(relationId);
            payload.setLinkedRecord(node, 'node');
            payload.setLinkedRecord(relation, 'relation');
            sharedUpdater(store, stixCoreRelationshipId, payload);
          },
          onCompleted: () => {
            setSubmitting(false);
            resetForm();
          },
        });
      },
    });
  }

  onReset() {
    this.handleToggleWrite();
  }

  render() {
    const {
      t, stixCoreRelationshipId, marginTop, data, classes,
    } = this.props;
    const { open } = this.state;
    const notes = pathOr([], ['stixCoreRelationship', 'notes', 'edges'], data);
    return (
      <div style={{ height: '100%', marginTop: marginTop || 40 }}>
        <Typography variant="h4" gutterBottom={true} style={{ float: 'left' }}>
          {t('Notes about this relationship')}
        </Typography>
        <Security needs={[KNOWLEDGE_KNUPDATE]}>
          <IconButton
            color="primary"
            onClick={this.handleToggleWrite.bind(this)}
            classes={{ root: classes.createButton }}
          >
            <EditOutlined fontSize="small" />
          </IconButton>
          <AddNotes
            stixCoreObjectOrStixCoreRelationshipId={stixCoreRelationshipId}
            stixCoreObjectOrStixCoreRelationshipNotes={notes}
          />
        </Security>
        <div className="clearfix" />
        {notes.map((noteEdge) => {
          const note = noteEdge.node;
          return (
            <StixCoreObjectOrStixCoreRelationshipNoteCard
              key={note.id}
              node={note}
              stixCoreObjectOrStixCoreRelationshipId={stixCoreRelationshipId}
            />
          );
        })}
        <Accordion
          style={{ margin: '30px 0 30px 0' }}
          expanded={open}
          onChange={this.handleToggleWrite.bind(this)}
        >
          <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
            <Typography className={classes.heading}>
              <RateReviewOutlined />
              &nbsp;&nbsp;&nbsp;&nbsp;
              <span style={{ fontWeight: 500 }}>{t('Write a note')}</span>
            </Typography>
          </AccordionSummary>
          <AccordionDetails style={{ width: '100%' }}>
            <Formik
              initialValues={{
                attribute_abstract: '',
                content: '',
              }}
              validationSchema={noteValidation(t)}
              onSubmit={this.onSubmit.bind(this)}
              onReset={this.onReset.bind(this)}
            >
              {({ submitForm, handleReset, isSubmitting }) => (
                <Form style={{ width: '100%' }}>
                  <Field
                    component={TextField}
                    name="attribute_abstract"
                    label={t('Abstract')}
                    fullWidth={true}
                  />
                  <Field
                    component={MarkDownField}
                    name="content"
                    label={t('Content')}
                    fullWidth={true}
                    multiline={true}
                    rows="4"
                    style={{ marginTop: 20 }}
                  />
                  <div className={classes.buttons}>
                    <Button
                      variant="contained"
                      onClick={handleReset}
                      disabled={isSubmitting}
                      classes={{ root: classes.button }}
                    >
                      {t('Cancel')}
                    </Button>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={submitForm}
                      disabled={isSubmitting}
                      classes={{ root: classes.button }}
                    >
                      {t('Create')}
                    </Button>
                  </div>
                </Form>
              )}
            </Formik>
          </AccordionDetails>
        </Accordion>
        <div style={{ marginTop: 100 }} />
        <div ref={this.bottomRef} />
      </div>
    );
  }
}

StixCoreRelationshipNotesCardsContainer.propTypes = {
  stixCoreRelationshipId: PropTypes.string,
  marginTop: PropTypes.number,
  data: PropTypes.object,
  classes: PropTypes.object,
  t: PropTypes.func,
};

export const stixCoreRelationshipNotesCardsQuery = graphql`
  query StixCoreRelationshipNotesCardsQuery($count: Int!, $id: String!) {
    ...StixCoreRelationshipNotesCards_data @arguments(count: $count, id: $id)
  }
`;

const StixCoreRelationshipNotesCards = createPaginationContainer(
  StixCoreRelationshipNotesCardsContainer,
  {
    data: graphql`
      fragment StixCoreRelationshipNotesCards_data on Query
      @argumentDefinitions(
        count: { type: "Int", defaultValue: 25 }
        id: { type: "String!" }
      ) {
        stixCoreRelationship(id: $id) {
          id
          objectMarking {
            edges {
              node {
                id
                definition
              }
            }
          }
          notes(first: $count) @connection(key: "Pagination_notes") {
            edges {
              node {
                id
                ...StixCoreObjectOrStixCoreRelationshipNoteCard_node
              }
            }
          }
        }
      }
    `,
  },
  {
    direction: 'forward',
    getConnectionFromProps(props) {
      return props.data && props.data.stixCoreRelationshipObject.notes;
    },
    getFragmentVariables(prevVars, totalCount) {
      return {
        ...prevVars,
        count: totalCount,
      };
    },
    getVariables(props, { count }, fragmentVariables) {
      return {
        count,
        id: fragmentVariables.id,
      };
    },
    query: stixCoreRelationshipNotesCardsQuery,
  },
);

export default compose(
  inject18n,
  withStyles(styles),
)(StixCoreRelationshipNotesCards);
