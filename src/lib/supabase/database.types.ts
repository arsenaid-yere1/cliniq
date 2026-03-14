export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      attorneys: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          email: string | null
          fax: string | null
          firm_name: string | null
          first_name: string
          id: string
          last_name: string
          notes: string | null
          phone: string | null
          state: string | null
          updated_at: string
          updated_by_user_id: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          firm_name?: string | null
          first_name: string
          id?: string
          last_name: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          firm_name?: string | null
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attorneys_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attorneys_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          id: string
          new_data: Json | null
          old_data: Json | null
          performed_at: string
          performed_by_user_id: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          performed_at?: string
          performed_by_user_id?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          performed_at?: string
          performed_by_user_id?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      case_status_history: {
        Row: {
          case_id: string
          changed_at: string
          changed_by_user_id: string | null
          id: string
          new_status: string
          notes: string | null
          previous_status: string | null
        }
        Insert: {
          case_id: string
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          new_status: string
          notes?: string | null
          previous_status?: string | null
        }
        Update: {
          case_id?: string
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          new_status?: string
          notes?: string | null
          previous_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_status_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_status_history_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      case_summaries: {
        Row: {
          ai_confidence: string | null
          ai_model: string | null
          case_id: string
          chief_complaint: string | null
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          extraction_notes: string | null
          generated_at: string | null
          generation_attempts: number
          generation_error: string | null
          generation_status: string
          id: string
          imaging_findings: Json
          prior_treatment: Json
          provider_overrides: Json
          raw_ai_response: Json | null
          review_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          source_data_hash: string | null
          suggested_diagnoses: Json
          symptoms_timeline: Json
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id: string
          chief_complaint?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          extraction_notes?: string | null
          generated_at?: string | null
          generation_attempts?: number
          generation_error?: string | null
          generation_status?: string
          id?: string
          imaging_findings?: Json
          prior_treatment?: Json
          provider_overrides?: Json
          raw_ai_response?: Json | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          source_data_hash?: string | null
          suggested_diagnoses?: Json
          symptoms_timeline?: Json
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id?: string
          chief_complaint?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          extraction_notes?: string | null
          generated_at?: string | null
          generation_attempts?: number
          generation_error?: string | null
          generation_status?: string
          id?: string
          imaging_findings?: Json
          prior_treatment?: Json
          provider_overrides?: Json
          raw_ai_response?: Json | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          source_data_hash?: string | null
          suggested_diagnoses?: Json
          symptoms_timeline?: Json
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_summaries_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_summaries_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_summaries_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_summaries_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          accident_date: string | null
          accident_description: string | null
          accident_type: string | null
          assigned_provider_id: string | null
          attorney_id: string | null
          balance_due: number
          case_close_date: string | null
          case_number: string
          case_open_date: string
          case_status: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          id: string
          lien_on_file: boolean
          patient_id: string
          total_billed: number
          total_paid: number
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          accident_date?: string | null
          accident_description?: string | null
          accident_type?: string | null
          assigned_provider_id?: string | null
          attorney_id?: string | null
          balance_due?: number
          case_close_date?: string | null
          case_number: string
          case_open_date?: string
          case_status?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          lien_on_file?: boolean
          patient_id: string
          total_billed?: number
          total_paid?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          accident_date?: string | null
          accident_description?: string | null
          accident_type?: string | null
          assigned_provider_id?: string | null
          attorney_id?: string | null
          balance_due?: number
          case_close_date?: string | null
          case_number?: string
          case_open_date?: string
          case_status?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          lien_on_file?: boolean
          patient_id?: string
          total_billed?: number
          total_paid?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_assigned_provider_id_fkey"
            columns: ["assigned_provider_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_attorney_id_fkey"
            columns: ["attorney_id"]
            isOneToOne: false
            referencedRelation: "attorneys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chiro_extractions: {
        Row: {
          ai_confidence: string | null
          ai_model: string | null
          case_id: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          diagnoses: Json
          document_id: string
          extracted_at: string | null
          extraction_attempts: number
          extraction_error: string | null
          extraction_notes: string | null
          extraction_status: string
          functional_outcomes: Json
          id: string
          plateau_statement: Json
          provider_overrides: Json
          raw_ai_response: Json | null
          report_date: string | null
          report_type: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          schema_version: number
          treatment_dates: Json
          treatment_modalities: Json
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          document_id: string
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          functional_outcomes?: Json
          id?: string
          plateau_statement?: Json
          provider_overrides?: Json
          raw_ai_response?: Json | null
          report_date?: string | null
          report_type?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          treatment_dates?: Json
          treatment_modalities?: Json
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          document_id?: string
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          functional_outcomes?: Json
          id?: string
          plateau_statement?: Json
          provider_overrides?: Json
          raw_ai_response?: Json | null
          report_date?: string | null
          report_type?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          treatment_dates?: Json
          treatment_modalities?: Json
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chiro_extractions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chiro_extractions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chiro_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chiro_extractions_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chiro_extractions_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_settings: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          clinic_name: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          email: string | null
          fax: string | null
          id: string
          logo_storage_path: string | null
          phone: string | null
          state: string | null
          updated_at: string
          updated_by_user_id: string | null
          website: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          clinic_name: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          logo_storage_path?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          clinic_name?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          logo_storage_path?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_settings_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_settings_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      discharge_notes: {
        Row: {
          ai_model: string | null
          assessment: string | null
          case_id: string
          clinician_disclaimer: string | null
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          diagnoses: string | null
          document_id: string | null
          finalized_at: string | null
          finalized_by_user_id: string | null
          generation_attempts: number
          generation_error: string | null
          id: string
          objective_cervical: string | null
          objective_general: string | null
          objective_lumbar: string | null
          objective_neurological: string | null
          objective_vitals: string | null
          patient_education: string | null
          patient_header: string | null
          plan_and_recommendations: string | null
          prognosis: string | null
          raw_ai_response: Json | null
          source_data_hash: string | null
          status: string
          subjective: string | null
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          ai_model?: string | null
          assessment?: string | null
          case_id: string
          clinician_disclaimer?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: string | null
          document_id?: string | null
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          generation_attempts?: number
          generation_error?: string | null
          id?: string
          objective_cervical?: string | null
          objective_general?: string | null
          objective_lumbar?: string | null
          objective_neurological?: string | null
          objective_vitals?: string | null
          patient_education?: string | null
          patient_header?: string | null
          plan_and_recommendations?: string | null
          prognosis?: string | null
          raw_ai_response?: Json | null
          source_data_hash?: string | null
          status?: string
          subjective?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          ai_model?: string | null
          assessment?: string | null
          case_id?: string
          clinician_disclaimer?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: string | null
          document_id?: string | null
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          generation_attempts?: number
          generation_error?: string | null
          id?: string
          objective_cervical?: string | null
          objective_general?: string | null
          objective_lumbar?: string | null
          objective_neurological?: string | null
          objective_vitals?: string | null
          patient_education?: string | null
          patient_header?: string | null
          plan_and_recommendations?: string | null
          prognosis?: string | null
          raw_ai_response?: Json | null
          source_data_hash?: string | null
          status?: string
          subjective?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discharge_notes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discharge_notes_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discharge_notes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discharge_notes_finalized_by_user_id_fkey"
            columns: ["finalized_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discharge_notes_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          case_id: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          document_type: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          notes: string | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          status: string
          updated_at: string
          updated_by_user_id: string | null
          uploaded_by_user_id: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          document_type: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
          uploaded_by_user_id?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          document_type?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      initial_visit_notes: {
        Row: {
          ai_model: string | null
          case_id: string
          chief_complaint: string | null
          clinician_disclaimer: string | null
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          diagnoses: string | null
          document_id: string | null
          finalized_at: string | null
          finalized_by_user_id: string | null
          generation_attempts: number
          generation_error: string | null
          history_of_accident: string | null
          id: string
          imaging_findings: string | null
          introduction: string | null
          medical_necessity: string | null
          motor_sensory_reflex: string | null
          past_medical_history: string | null
          patient_education: string | null
          physical_exam: string | null
          prognosis: string | null
          raw_ai_response: Json | null
          review_of_systems: string | null
          social_history: string | null
          source_data_hash: string | null
          status: string
          treatment_plan: string | null
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          ai_model?: string | null
          case_id: string
          chief_complaint?: string | null
          clinician_disclaimer?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: string | null
          document_id?: string | null
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          generation_attempts?: number
          generation_error?: string | null
          history_of_accident?: string | null
          id?: string
          imaging_findings?: string | null
          introduction?: string | null
          medical_necessity?: string | null
          motor_sensory_reflex?: string | null
          past_medical_history?: string | null
          patient_education?: string | null
          physical_exam?: string | null
          prognosis?: string | null
          raw_ai_response?: Json | null
          review_of_systems?: string | null
          social_history?: string | null
          source_data_hash?: string | null
          status?: string
          treatment_plan?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          ai_model?: string | null
          case_id?: string
          chief_complaint?: string | null
          clinician_disclaimer?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: string | null
          document_id?: string | null
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          generation_attempts?: number
          generation_error?: string | null
          history_of_accident?: string | null
          id?: string
          imaging_findings?: string | null
          introduction?: string | null
          medical_necessity?: string | null
          motor_sensory_reflex?: string | null
          past_medical_history?: string | null
          patient_education?: string | null
          physical_exam?: string | null
          prognosis?: string | null
          raw_ai_response?: Json | null
          review_of_systems?: string | null
          social_history?: string | null
          source_data_hash?: string | null
          status?: string
          treatment_plan?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "initial_visit_notes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initial_visit_notes_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initial_visit_notes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initial_visit_notes_finalized_by_user_id_fkey"
            columns: ["finalized_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initial_visit_notes_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          cpt_code: string | null
          created_at: string
          description: string
          id: string
          invoice_id: string
          procedure_id: string | null
          quantity: number
          service_date: string | null
          total_price: number
          unit_price: number
        }
        Insert: {
          cpt_code?: string | null
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          procedure_id?: string | null
          quantity?: number
          service_date?: string | null
          total_price: number
          unit_price: number
        }
        Update: {
          cpt_code?: string | null
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          procedure_id?: string | null
          quantity?: number
          service_date?: string | null
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_status_history: {
        Row: {
          changed_at: string
          changed_by_user_id: string | null
          id: string
          invoice_id: string
          metadata: Json | null
          new_status: string
          previous_status: string | null
          reason: string | null
        }
        Insert: {
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          invoice_id: string
          metadata?: Json | null
          new_status: string
          previous_status?: string | null
          reason?: string | null
        }
        Update: {
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          invoice_id?: string
          metadata?: Json | null
          new_status?: string
          previous_status?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_status_history_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_status_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          case_id: string
          claim_type: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          diagnoses_snapshot: Json
          due_date: string | null
          id: string
          indication: string | null
          invoice_date: string
          invoice_number: string
          invoice_type: string
          notes: string | null
          paid_amount: number
          payee_address: string | null
          payee_name: string | null
          status: string
          total_amount: number
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          case_id: string
          claim_type?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses_snapshot?: Json
          due_date?: string | null
          id?: string
          indication?: string | null
          invoice_date?: string
          invoice_number: string
          invoice_type?: string
          notes?: string | null
          paid_amount?: number
          payee_address?: string | null
          payee_name?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          case_id?: string
          claim_type?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses_snapshot?: Json
          due_date?: string | null
          id?: string
          indication?: string | null
          invoice_date?: string
          invoice_number?: string
          invoice_type?: string
          notes?: string | null
          paid_amount?: number
          payee_address?: string | null
          payee_name?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mri_extractions: {
        Row: {
          ai_confidence: string | null
          ai_model: string | null
          body_region: string | null
          case_id: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          document_id: string
          extracted_at: string | null
          extraction_attempts: number
          extraction_error: string | null
          extraction_notes: string | null
          extraction_status: string
          findings: Json
          id: string
          impression_summary: string | null
          mri_date: string | null
          provider_overrides: Json
          raw_ai_response: Json | null
          review_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          schema_version: number
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_model?: string | null
          body_region?: string | null
          case_id: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          document_id: string
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          findings?: Json
          id?: string
          impression_summary?: string | null
          mri_date?: string | null
          provider_overrides?: Json
          raw_ai_response?: Json | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_model?: string | null
          body_region?: string | null
          case_id?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          document_id?: string
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          findings?: Json
          id?: string
          impression_summary?: string | null
          mri_date?: string | null
          provider_overrides?: Json
          raw_ai_response?: Json | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mri_extractions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mri_extractions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mri_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mri_extractions_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mri_extractions_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      orthopedic_extractions: {
        Row: {
          ai_confidence: string | null
          ai_model: string | null
          allergies: string | null
          case_id: string
          created_at: string
          created_by_user_id: string | null
          current_employment: string | null
          current_medications: Json
          date_of_injury: string | null
          deleted_at: string | null
          diagnoses: Json
          diagnostics: Json
          document_id: string
          examining_provider: string | null
          extracted_at: string | null
          extraction_attempts: number
          extraction_error: string | null
          extraction_notes: string | null
          extraction_status: string
          family_history: string | null
          hand_dominance: string | null
          height: string | null
          history_of_injury: string | null
          id: string
          past_medical_history: string | null
          patient_age: number | null
          patient_sex: string | null
          physical_exam: Json
          present_complaints: Json
          previous_complaints: string | null
          provider_overrides: Json
          provider_specialty: string | null
          raw_ai_response: Json | null
          recommendations: Json
          report_date: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          schema_version: number
          social_history: string | null
          subsequent_complaints: string | null
          surgical_history: string | null
          updated_at: string
          updated_by_user_id: string | null
          weight: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_model?: string | null
          allergies?: string | null
          case_id: string
          created_at?: string
          created_by_user_id?: string | null
          current_employment?: string | null
          current_medications?: Json
          date_of_injury?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          diagnostics?: Json
          document_id: string
          examining_provider?: string | null
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          family_history?: string | null
          hand_dominance?: string | null
          height?: string | null
          history_of_injury?: string | null
          id?: string
          past_medical_history?: string | null
          patient_age?: number | null
          patient_sex?: string | null
          physical_exam?: Json
          present_complaints?: Json
          previous_complaints?: string | null
          provider_overrides?: Json
          provider_specialty?: string | null
          raw_ai_response?: Json | null
          recommendations?: Json
          report_date?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          social_history?: string | null
          subsequent_complaints?: string | null
          surgical_history?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          weight?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_model?: string | null
          allergies?: string | null
          case_id?: string
          created_at?: string
          created_by_user_id?: string | null
          current_employment?: string | null
          current_medications?: Json
          date_of_injury?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          diagnostics?: Json
          document_id?: string
          examining_provider?: string | null
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          family_history?: string | null
          hand_dominance?: string | null
          height?: string | null
          history_of_injury?: string | null
          id?: string
          past_medical_history?: string | null
          patient_age?: number | null
          patient_sex?: string | null
          physical_exam?: Json
          present_complaints?: Json
          previous_complaints?: string | null
          provider_overrides?: Json
          provider_specialty?: string | null
          raw_ai_response?: Json | null
          recommendations?: Json
          report_date?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          social_history?: string | null
          subsequent_complaints?: string | null
          surgical_history?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          weight?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orthopedic_extractions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orthopedic_extractions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orthopedic_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orthopedic_extractions_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orthopedic_extractions_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pain_management_extractions: {
        Row: {
          ai_confidence: string | null
          ai_model: string | null
          case_id: string
          chief_complaints: Json
          created_at: string
          created_by_user_id: string | null
          date_of_injury: string | null
          deleted_at: string | null
          diagnoses: Json
          diagnostic_studies_summary: string | null
          document_id: string
          examining_provider: string | null
          extracted_at: string | null
          extraction_attempts: number
          extraction_error: string | null
          extraction_notes: string | null
          extraction_status: string
          id: string
          physical_exam: Json
          provider_overrides: Json
          raw_ai_response: Json | null
          report_date: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          schema_version: number
          treatment_plan: Json
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id: string
          chief_complaints?: Json
          created_at?: string
          created_by_user_id?: string | null
          date_of_injury?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          diagnostic_studies_summary?: string | null
          document_id: string
          examining_provider?: string | null
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          id?: string
          physical_exam?: Json
          provider_overrides?: Json
          raw_ai_response?: Json | null
          report_date?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          treatment_plan?: Json
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id?: string
          chief_complaints?: Json
          created_at?: string
          created_by_user_id?: string | null
          date_of_injury?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          diagnostic_studies_summary?: string | null
          document_id?: string
          examining_provider?: string | null
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          id?: string
          physical_exam?: Json
          provider_overrides?: Json
          raw_ai_response?: Json | null
          report_date?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          treatment_plan?: Json
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pain_management_extractions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pain_management_extractions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pain_management_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pain_management_extractions_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pain_management_extractions_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string
          created_by_user_id: string | null
          date_of_birth: string
          deleted_at: string | null
          email: string | null
          first_name: string
          gender: string | null
          id: string
          last_name: string
          middle_name: string | null
          phone_primary: string | null
          phone_secondary: string | null
          state: string | null
          updated_at: string
          updated_by_user_id: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          created_by_user_id?: string | null
          date_of_birth: string
          deleted_at?: string | null
          email?: string | null
          first_name: string
          gender?: string | null
          id?: string
          last_name: string
          middle_name?: string | null
          phone_primary?: string | null
          phone_secondary?: string | null
          state?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          created_by_user_id?: string | null
          date_of_birth?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          gender?: string | null
          id?: string
          last_name?: string
          middle_name?: string | null
          phone_primary?: string | null
          phone_secondary?: string | null
          state?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by_user_id: string | null
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          reference_number: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          reference_number?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_notes: {
        Row: {
          ai_model: string | null
          allergies: string | null
          assessment_and_plan: string | null
          assessment_summary: string | null
          case_id: string
          clinician_disclaimer: string | null
          created_at: string
          created_by_user_id: string | null
          current_medications: string | null
          deleted_at: string | null
          document_id: string | null
          finalized_at: string | null
          finalized_by_user_id: string | null
          generation_attempts: number
          generation_error: string | null
          id: string
          objective_physical_exam: string | null
          objective_vitals: string | null
          past_medical_history: string | null
          patient_education: string | null
          patient_header: string | null
          procedure_anesthesia: string | null
          procedure_followup: string | null
          procedure_id: string
          procedure_indication: string | null
          procedure_injection: string | null
          procedure_post_care: string | null
          procedure_preparation: string | null
          procedure_prp_prep: string | null
          prognosis: string | null
          raw_ai_response: Json | null
          review_of_systems: string | null
          social_history: string | null
          source_data_hash: string | null
          status: string
          subjective: string | null
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          ai_model?: string | null
          allergies?: string | null
          assessment_and_plan?: string | null
          assessment_summary?: string | null
          case_id: string
          clinician_disclaimer?: string | null
          created_at?: string
          created_by_user_id?: string | null
          current_medications?: string | null
          deleted_at?: string | null
          document_id?: string | null
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          generation_attempts?: number
          generation_error?: string | null
          id?: string
          objective_physical_exam?: string | null
          objective_vitals?: string | null
          past_medical_history?: string | null
          patient_education?: string | null
          patient_header?: string | null
          procedure_anesthesia?: string | null
          procedure_followup?: string | null
          procedure_id: string
          procedure_indication?: string | null
          procedure_injection?: string | null
          procedure_post_care?: string | null
          procedure_preparation?: string | null
          procedure_prp_prep?: string | null
          prognosis?: string | null
          raw_ai_response?: Json | null
          review_of_systems?: string | null
          social_history?: string | null
          source_data_hash?: string | null
          status?: string
          subjective?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          ai_model?: string | null
          allergies?: string | null
          assessment_and_plan?: string | null
          assessment_summary?: string | null
          case_id?: string
          clinician_disclaimer?: string | null
          created_at?: string
          created_by_user_id?: string | null
          current_medications?: string | null
          deleted_at?: string | null
          document_id?: string | null
          finalized_at?: string | null
          finalized_by_user_id?: string | null
          generation_attempts?: number
          generation_error?: string | null
          id?: string
          objective_physical_exam?: string | null
          objective_vitals?: string | null
          past_medical_history?: string | null
          patient_education?: string | null
          patient_header?: string | null
          procedure_anesthesia?: string | null
          procedure_followup?: string | null
          procedure_id?: string
          procedure_indication?: string | null
          procedure_injection?: string | null
          procedure_post_care?: string | null
          procedure_preparation?: string | null
          procedure_prp_prep?: string | null
          prognosis?: string | null
          raw_ai_response?: Json | null
          review_of_systems?: string | null
          social_history?: string | null
          source_data_hash?: string | null
          status?: string
          subjective?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedure_notes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_notes_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_notes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_notes_finalized_by_user_id_fkey"
            columns: ["finalized_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_notes_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_notes_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      procedures: {
        Row: {
          activity_restriction_hrs: number | null
          anesthetic_agent: string | null
          anesthetic_dose_ml: number | null
          blood_draw_volume_ml: number | null
          case_id: string
          centrifuge_duration_min: number | null
          charge_amount: number | null
          complications: string | null
          compression_bandage: boolean | null
          consent_obtained: boolean | null
          cpt_code: string | null
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          diagnoses: Json
          guidance_method: string | null
          id: string
          injection_site: string | null
          injection_volume_ml: number | null
          kit_lot_number: string | null
          laterality: string | null
          needle_gauge: string | null
          notes: string | null
          pain_rating: number | null
          patient_tolerance: string | null
          prep_protocol: string | null
          procedure_date: string
          procedure_name: string
          procedure_number: number | null
          provider_id: string | null
          supplies_used: string | null
          target_confirmed_imaging: boolean | null
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          activity_restriction_hrs?: number | null
          anesthetic_agent?: string | null
          anesthetic_dose_ml?: number | null
          blood_draw_volume_ml?: number | null
          case_id: string
          centrifuge_duration_min?: number | null
          charge_amount?: number | null
          complications?: string | null
          compression_bandage?: boolean | null
          consent_obtained?: boolean | null
          cpt_code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          guidance_method?: string | null
          id?: string
          injection_site?: string | null
          injection_volume_ml?: number | null
          kit_lot_number?: string | null
          laterality?: string | null
          needle_gauge?: string | null
          notes?: string | null
          pain_rating?: number | null
          patient_tolerance?: string | null
          prep_protocol?: string | null
          procedure_date: string
          procedure_name: string
          procedure_number?: number | null
          provider_id?: string | null
          supplies_used?: string | null
          target_confirmed_imaging?: boolean | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          activity_restriction_hrs?: number | null
          anesthetic_agent?: string | null
          anesthetic_dose_ml?: number | null
          blood_draw_volume_ml?: number | null
          case_id?: string
          centrifuge_duration_min?: number | null
          charge_amount?: number | null
          complications?: string | null
          compression_bandage?: boolean | null
          consent_obtained?: boolean | null
          cpt_code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          guidance_method?: string | null
          id?: string
          injection_site?: string | null
          injection_volume_ml?: number | null
          kit_lot_number?: string | null
          laterality?: string | null
          needle_gauge?: string | null
          notes?: string | null
          pain_rating?: number | null
          patient_tolerance?: string | null
          prep_protocol?: string | null
          procedure_date?: string
          procedure_name?: string
          procedure_number?: number | null
          provider_id?: string | null
          supplies_used?: string | null
          target_confirmed_imaging?: boolean | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedures_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedures_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedures_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedures_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_profiles: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          credentials: string | null
          deleted_at: string | null
          display_name: string
          id: string
          license_number: string | null
          npi_number: string | null
          signature_storage_path: string | null
          updated_at: string
          updated_by_user_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          credentials?: string | null
          deleted_at?: string | null
          display_name: string
          id?: string
          license_number?: string | null
          npi_number?: string | null
          signature_storage_path?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          credentials?: string | null
          deleted_at?: string | null
          display_name?: string
          id?: string
          license_number?: string | null
          npi_number?: string | null
          signature_storage_path?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_profiles_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_profiles_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_extractions: {
        Row: {
          ai_confidence: string | null
          ai_model: string | null
          case_id: string
          causation_statement: string | null
          chief_complaint: string | null
          clinical_impression: string | null
          created_at: string
          created_by_user_id: string | null
          date_of_injury: string | null
          deleted_at: string | null
          diagnoses: Json
          document_id: string
          evaluating_therapist: string | null
          evaluation_date: string | null
          extracted_at: string | null
          extraction_attempts: number
          extraction_error: string | null
          extraction_notes: string | null
          extraction_status: string
          functional_limitations: string | null
          functional_tests: Json
          gait_analysis: string | null
          id: string
          long_term_goals: Json
          mechanism_of_injury: string | null
          muscle_strength: Json
          neurological_screening: Json
          outcome_measures: Json
          pain_ratings: Json
          palpation_findings: Json
          plan_of_care: Json
          postural_assessment: string | null
          prior_treatment: string | null
          prognosis: string | null
          provider_overrides: Json
          range_of_motion: Json
          raw_ai_response: Json | null
          referring_provider: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          schema_version: number
          short_term_goals: Json
          special_tests: Json
          updated_at: string
          updated_by_user_id: string | null
          work_status: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id: string
          causation_statement?: string | null
          chief_complaint?: string | null
          clinical_impression?: string | null
          created_at?: string
          created_by_user_id?: string | null
          date_of_injury?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          document_id: string
          evaluating_therapist?: string | null
          evaluation_date?: string | null
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          functional_limitations?: string | null
          functional_tests?: Json
          gait_analysis?: string | null
          id?: string
          long_term_goals?: Json
          mechanism_of_injury?: string | null
          muscle_strength?: Json
          neurological_screening?: Json
          outcome_measures?: Json
          pain_ratings?: Json
          palpation_findings?: Json
          plan_of_care?: Json
          postural_assessment?: string | null
          prior_treatment?: string | null
          prognosis?: string | null
          provider_overrides?: Json
          range_of_motion?: Json
          raw_ai_response?: Json | null
          referring_provider?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          short_term_goals?: Json
          special_tests?: Json
          updated_at?: string
          updated_by_user_id?: string | null
          work_status?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_model?: string | null
          case_id?: string
          causation_statement?: string | null
          chief_complaint?: string | null
          clinical_impression?: string | null
          created_at?: string
          created_by_user_id?: string | null
          date_of_injury?: string | null
          deleted_at?: string | null
          diagnoses?: Json
          document_id?: string
          evaluating_therapist?: string | null
          evaluation_date?: string | null
          extracted_at?: string | null
          extraction_attempts?: number
          extraction_error?: string | null
          extraction_notes?: string | null
          extraction_status?: string
          functional_limitations?: string | null
          functional_tests?: Json
          gait_analysis?: string | null
          id?: string
          long_term_goals?: Json
          mechanism_of_injury?: string | null
          muscle_strength?: Json
          neurological_screening?: Json
          outcome_measures?: Json
          pain_ratings?: Json
          palpation_findings?: Json
          plan_of_care?: Json
          postural_assessment?: string | null
          prior_treatment?: string | null
          prognosis?: string | null
          provider_overrides?: Json
          range_of_motion?: Json
          raw_ai_response?: Json | null
          referring_provider?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          schema_version?: number
          short_term_goals?: Json
          special_tests?: Json
          updated_at?: string
          updated_by_user_id?: string | null
          work_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pt_extractions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_extractions_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_extractions_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_extractions_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_catalog: {
        Row: {
          cpt_code: string
          created_at: string
          created_by_user_id: string | null
          default_price: number
          deleted_at: string | null
          description: string
          id: string
          sort_order: number
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          cpt_code: string
          created_at?: string
          created_by_user_id?: string | null
          default_price?: number
          deleted_at?: string | null
          description: string
          id?: string
          sort_order?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          cpt_code?: string
          created_at?: string
          created_by_user_id?: string | null
          default_price?: number
          deleted_at?: string | null
          description?: string
          id?: string
          sort_order?: number
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_catalog_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_catalog_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      vital_signs: {
        Row: {
          bp_diastolic: number | null
          bp_systolic: number | null
          case_id: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          heart_rate: number | null
          id: string
          procedure_id: string | null
          recorded_at: string
          respiratory_rate: number | null
          spo2_percent: number | null
          temperature_f: number | null
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          bp_diastolic?: number | null
          bp_systolic?: number | null
          case_id: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          heart_rate?: number | null
          id?: string
          procedure_id?: string | null
          recorded_at?: string
          respiratory_rate?: number | null
          spo2_percent?: number | null
          temperature_f?: number | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          bp_diastolic?: number | null
          bp_systolic?: number | null
          case_id?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          heart_rate?: number | null
          id?: string
          procedure_id?: string | null
          recorded_at?: string
          respiratory_rate?: number | null
          spo2_percent?: number | null
          temperature_f?: number | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_signs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
